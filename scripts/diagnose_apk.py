"""Diagnose the checked-in APK on a disposable Android emulator, without signing it.

The stock Google APIs emulator is not a Samsung device. Browser-provider absence
is reported as an inconclusive environment result, never as an app crash.
"""

import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import time
import xml.etree.ElementTree as ET


PACKAGE = "com.maxparks.ttobokhome"
CHROME = "com.android.chrome"
OUTPUT = Path("apk-diagnostics")


def capture(name, command, timeout=45):
    """Keep complete command output even when the operation fails."""
    try:
        result = subprocess.run(command, capture_output=True, text=True,
                                errors="replace", timeout=timeout)
        code, output = result.returncode, result.stdout + result.stderr
    except subprocess.TimeoutExpired as error:
        code, output = 124, f"Timed out after {timeout}s: {error}"
    except OSError as error:
        code, output = 127, str(error)
    (OUTPUT / name).write_text(
        f"Command: {command!r}\nExit code: {code}\n{output}", encoding="utf-8")
    print(f"{name}: exit {code}", flush=True)
    return code, output


def app_crashed(crash_log):
    package = re.escape(PACKAGE)
    return bool(re.search(
        rf"Process:\s+{package}(?::[^,\s]+)?,\s+PID:|>>>\s*{package}(?::\S+)?\s*<<<|Cmdline:\s*{package}\s*$",
        crash_log))


def resumed_in(activities, packages):
    resumed = "\n".join(line for line in activities.splitlines()
                        if "mResumedActivity" in line or "topResumedActivity" in line)
    return any(re.search(rf"\b{re.escape(package)}/", resumed) for package in packages)


def twa_evidence(activities, ui, logcat):
    """Require real DAL and rendered web UI; a CustomTabActivity name proves neither."""
    chrome_foreground = resumed_in(activities, [CHROME])
    # This callback comes from CustomTabsSession.validateRelationship(2, origin),
    # not from an intent extra or a log that merely says launch was requested.
    results = re.findall(
        r"\bTtobokLauncher\s*:\s*DAL relation=2 origin=https://max-parks\.github\.io/? result=(true|false)\b",
        logcat)
    dal_verified = bool(results and results[-1] == "true")
    planner_loaded, planner_variant, chrome_controls, parse_error = False, None, [], None
    try:
        start, end = ui.index("<hierarchy"), ui.rindex("</hierarchy>") + len("</hierarchy>")
        tree = ET.fromstring(ui[start:end])
        for webview in tree.iter("node"):
            if webview.get("class") == "android.webkit.WebView":
                text = " ".join(node.get("text", "") + " " + node.get("content-desc", "")
                                for node in webview.iter("node"))
                for variant, labels in [("compact", ["맞춤", "전체화면", "보기 설정"]),
                                        ("v3.64", ["도면 크게", "화면 기준", "글자"])]:
                    if all(label in text for label in labels):
                        planner_loaded, planner_variant = True, variant
        controls = {"url_bar", "location_bar", "location_bar_frame", "toolbar",
                    "custom_tabs_toolbar", "close_button", "close_minimize_layout",
                    "menu_button", "menu_button_wrapper", "minimize_button"}
        for node in tree.iter("node"):
            resource = node.get("resource-id", "")
            if not resource.startswith(CHROME + ":id/") or resource.split("/")[-1] not in controls:
                continue
            bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
            if bounds and int(bounds[3]) > int(bounds[1]) and int(bounds[4]) > int(bounds[2]):
                chrome_controls.append(resource)
    except (ValueError, ET.ParseError) as error:
        parse_error = str(error)
    return {"chrome_foreground": chrome_foreground,
            "dal_relationship_verified": dal_verified,
            "planner_content_loaded": planner_loaded,
            "planner_ui_variant": planner_variant,
            "browser_toolbar_nodes": sorted(set(chrome_controls)),
            "ui_parse_error": parse_error,
            "verified": chrome_foreground and dal_verified and planner_loaded and not chrome_controls and parse_error is None}


def compiled_asset_statements(resources):
    # aapt escapes quotes, backslashes and newlines in its outer string. Decode
    # that first, then validate the JSON the Android package actually contains.
    values = re.findall(r'(?m)^\s*resource \S+ \S+:string/asset_statements:[^\r\n]*\r?\n\s*\(string(?:8|16)\) ("[^\r\n]*")', resources)
    decoded = []
    try:
        for value in values:
            statements = json.loads(json.loads(value))
            if not isinstance(statements, list):
                raise ValueError("asset_statements must contain a JSON array")
            if not any(isinstance(item, dict)
                       and "delegate_permission/common.handle_all_urls" in item.get("relation", [])
                       and item.get("target") == {"namespace": "web", "site": "https://max-parks.github.io"}
                       for item in statements):
                raise ValueError("Compiled asset_statements lacks exact planner origin and handle_all_urls relation")
            decoded.append(statements)
        return {"valid": bool(values), "values": decoded, "error": None if values else "Compiled asset_statements resource missing"}
    except (ValueError, TypeError) as error:
        return {"valid": False, "values": decoded, "error": str(error)}


def prepare_chrome(providers):
    """Skip only Chrome onboarding on the disposable emulator; never bypass DAL."""
    _, emulator = capture("emulator-check.txt", ["adb", "shell", "getprop", "ro.kernel.qemu"])
    if emulator.strip() != "1" or CHROME not in providers:
        print("Strict TWA test requires the disposable emulator with com.android.chrome", flush=True)
        return False, False
    # Chromium CommandLineInitUtil reads /data/local/tmp for the debug app.
    # --disable-fre suppresses onboarding only; no trusted-origin/security flags.
    # https://chromium.googlesource.com/chromium/src/+/main/base/android/java/src/org/chromium/base/CommandLineInitUtil.java
    flags = OUTPUT / "chrome-command-line"
    flags.write_text("chrome --disable-fre --no-default-browser-check\n", encoding="utf-8")
    steps = [
        ("chrome-stop.txt", ["adb", "shell", "am", "force-stop", CHROME]),
        ("chrome-debug-app.txt", ["adb", "shell", "am", "set-debug-app", "--persistent", CHROME]),
        ("chrome-flags-push.txt", ["adb", "push", str(flags), "/data/local/tmp/chrome-command-line"]),
        ("chrome-flags-mode.txt", ["adb", "shell", "chmod", "644", "/data/local/tmp/chrome-command-line"]),
        ("chrome-flags-readback.txt", ["adb", "shell", "cat", "/data/local/tmp/chrome-command-line"]),
    ]
    return all(code == 0 for code, _ in [capture(name, command) for name, command in steps]), True


def capture_ui(label):
    capture(f"ui-remove-{label}.txt", ["adb", "shell", "rm", "-f", "/sdcard/ttobok-window.xml"])
    code, _ = capture(f"ui-dump-{label}.txt", ["adb", "shell", "uiautomator", "dump", "/sdcard/ttobok-window.xml"])
    read_code, ui = capture(f"ui-{label}.xml", ["adb", "shell", "cat", "/sdcard/ttobok-window.xml"])
    return ui if code == 0 and read_code == 0 else ""


def wait_for_twa(activities, ui):
    evidence = None
    # Chrome may initially hide its toolbar optimistically while DAL is pending.
    # A real positive validation callback must arrive before this gate can pass.
    for attempt in range(9):
        label = f"twa-{attempt}"
        _, logcat = capture(f"logcat-{label}.txt", [
            "adb", "logcat", "-d", "-v", "threadtime", "-s", "TtobokLauncher:I",
            "chromium:V", "cr_OriginVerifier:V", "*:S"])
        evidence = twa_evidence(activities, ui, logcat)
        (OUTPUT / f"evidence-{label}.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
        if evidence["verified"] or attempt == 8:
            snapshot("twa-final")
            screenshot = OUTPUT / "screen-twa-final.png"
            evidence["screenshot_captured"] = screenshot.exists() and screenshot.read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
            evidence["verified"] &= evidence["screenshot_captured"]
            (OUTPUT / "evidence-twa-final.json").write_text(json.dumps(evidence, indent=2), encoding="utf-8")
            break
        time.sleep(5)
        _, activities = capture(f"activities-{label}.txt", ["adb", "shell", "dumpsys", "activity", "activities"])
        ui = capture_ui(label)
    return activities, ui, evidence


def snapshot(label):
    _, activities = capture(f"activities-{label}.txt", ["adb", "shell", "dumpsys", "activity", "activities"])
    capture(f"windows-{label}.txt", ["adb", "shell", "dumpsys", "window", "windows"])
    try:
        shot = subprocess.run(["adb", "exec-out", "screencap", "-p"],
                              capture_output=True, timeout=20)
        if shot.returncode == 0:
            (OUTPUT / f"screen-{label}.png").write_bytes(shot.stdout)
    except (OSError, subprocess.TimeoutExpired) as error:
        (OUTPUT / f"screen-{label}-error.txt").write_text(str(error), encoding="utf-8")
    return activities


def discover_browsers():
    _, browsers = capture("browser-providers.txt", [
        "adb", "shell", "cmd", "package", "query-activities", "--brief", "--components",
        "-a", "android.intent.action.VIEW", "-c", "android.intent.category.BROWSABLE",
        "-d", "https://max-parks.github.io/Park-s-Fam/"])
    capture("custom-tabs-services.txt", [
        "adb", "shell", "cmd", "package", "query-services", "--brief", "--components",
        "-a", "android.support.customtabs.action.CustomTabsService"])
    capture("default-browser.txt", ["adb", "shell", "cmd", "role", "get-role-holders", "android.app.role.BROWSER"])
    return sorted(set(re.findall(r"(?m)^\s*([\w.]+)/[\w.$]+\s*$", browsers)))


def launch_scenario(activity, without_browser, require_recovery, require_twa=False):
    providers = discover_browsers()
    capture("clear-logcat.txt", ["adb", "logcat", "-b", "all", "-c"])
    start_code, start = capture("am-start.txt", ["adb", "shell", "am", "start", "-W", "-S", "-n", activity])
    time.sleep(3)
    snapshot("3s")
    time.sleep(12)
    activities = snapshot("15s")
    ui = capture_ui("15s")
    twa = None
    if require_twa and not without_browser:
        activities, ui, twa = wait_for_twa(activities, ui)
    resumed = "\n".join(line for line in activities.splitlines()
                        if "mResumedActivity" in line or "topResumedActivity" in line)
    handoff = resumed_in(activities, providers) or bool(re.search(r"ResolverActivity|ChooserActivity", resumed))
    back_returned = None
    if require_recovery and not without_browser and handoff:
        capture("press-back.txt", ["adb", "shell", "input", "keyevent", "KEYCODE_BACK"])
        time.sleep(3)
        after_back = snapshot("after-back")
        back_returned = resumed_in(after_back, [PACKAGE])
    _, crash = capture("crash.txt", ["adb", "logcat", "-b", "crash", "-d", "-v", "threadtime"])
    capture("logcat.txt", ["adb", "logcat", "-b", "all", "-d", "-v", "threadtime"])
    capture("exit-info.txt", ["adb", "shell", "dumpsys", "activity", "exit-info", PACKAGE])
    _, process = capture("app-process.txt", ["adb", "shell", "pidof", PACKAGE])
    process_alive = bool(re.fullmatch(r"\d+(?:\s+\d+)*", process.strip()))
    visible = resumed_in(activities, [PACKAGE])
    recovery = visible and all(text in ui for text in ["브라우저를 열지 못했습니다", "다시 열기", "브라우저로 열기"])
    result = {"without_browser": without_browser, "providers": providers,
              "native_activity_visible": visible, "app_process_present": process_alive,
              "recovery_controls_visible": recovery, "browser_handoff_observed": handoff,
              "returned_to_launcher_after_back": back_returned, "twa_evidence": twa}
    if app_crashed(crash):
        result["result"] = "native_app_crash"
    elif start_code or re.search(r"(?m)^Error", start):
        result["result"] = "activity_launch_failed"
    elif without_browser and providers:
        result["result"] = "inconclusive_browser_disabling_failed"
    elif not without_browser and not providers:
        result["result"] = "inconclusive_no_browser_provider"
    elif without_browser and require_recovery and not recovery:
        result["result"] = "visible_recovery_ui_missing"
    elif require_recovery and not without_browser and not handoff:
        result["result"] = "browser_handoff_not_observed"
    elif require_twa and not without_browser and not twa["verified"]:
        result["result"] = "trusted_fullscreen_planner_not_verified"
    elif require_recovery and not without_browser and back_returned is not True:
        result["result"] = "back_did_not_return_to_launcher"
    elif require_recovery and not process_alive:
        result["result"] = "native_launcher_process_missing"
    else:
        # The original TWA launcher normally finishes after handing off to a
        # browser. Absence of that old launcher PID is not by itself a crash.
        result["result"] = "no_native_crash_observed_review_browser_screenshots"
    return result


def self_test():
    """Fail closed on browser chrome, onboarding, or unverified web content."""
    assert "twa_evidence" in globals(), "Strict TWA evidence evaluator is missing"
    activities = "topResumedActivity=ActivityRecord{123 u0 com.android.chrome/org.chromium.chrome.browser.customtabs.CustomTabActivity t2}"
    ui = '''<hierarchy><node package="com.android.chrome" class="android.webkit.WebView" bounds="[0,80][1080,2200]">
      <node text="맞춤" bounds="[10,1900][100,1960]"/>
      <node text="전체화면" bounds="[110,1900][250,1960]"/>
      <node content-desc="보기 설정" bounds="[260,1900][320,1960]"/>
    </node></hierarchy>'''
    verified = "10-22 12:00:00.000 123 123 I TtobokLauncher: DAL relation=2 origin=https://max-parks.github.io result=true"
    assert twa_evidence(activities, ui, verified)["verified"], "Verified planner without browser chrome should pass"
    old_ui = ui.replace("맞춤", "화면 기준").replace("전체화면", "도면 크게").replace("보기 설정", "글자")
    assert twa_evidence(activities, old_ui, verified)["planner_ui_variant"] == "v3.64", "Published planner UI must remain recognizable before the coordinated release"
    toolbar = '<node package="com.android.chrome" resource-id="com.android.chrome:id/url_bar" bounds="[50,80][900,220]"/>'
    assert not twa_evidence(activities, ui.replace("</hierarchy>", toolbar + "</hierarchy>"), verified)["verified"], "Custom Tab URL bar must fail"
    close = toolbar.replace("url_bar", "close_button")
    assert not twa_evidence(activities, ui.replace("</hierarchy>", close + "</hierarchy>"), verified)["verified"], "Custom Tab close button must fail"
    assert not twa_evidence(activities, '<hierarchy><node text="Welcome to Chrome"/></hierarchy>', verified)["verified"], "Onboarding is not loaded planner content"
    assert not twa_evidence(activities, ui, "")["verified"], "Optimistic toolbar hiding is not proof of DAL"
    assert not twa_evidence(activities, ui, verified.replace("result=true", "result=false"))["verified"], "Failed DAL must fail"
    assert not twa_evidence(activities, ui, verified.replace("max-parks.github.io", "example.com"))["verified"], "A different origin cannot verify this app"
    assert not twa_evidence(activities, ui, verified.replace("relation=2", "relation=1"))["verified"], "Use-as-origin is not handle-all-URLs"
    assert not twa_evidence(activities, ui, verified + "\n" + verified.replace("result=true", "result=false"))["verified"], "Latest failed verification must win"
    assert not twa_evidence(activities.replace("com.android.chrome/", PACKAGE + "/"), ui, verified)["verified"], "Native launcher foreground is not browser content"
    assert not twa_evidence(activities, "malformed XML", verified)["verified"], "Missing UI evidence must fail closed"
    assert "compiled_asset_statements" in globals(), "Compiled asset-statements checker is missing"
    resource = r'''resource 0x7f080001 com.maxparks.ttobokhome:string/asset_statements: t=0x03
      (string8) "[{\"relation\":[\"delegate_permission/common.handle_all_urls\"],\"target\":{\"namespace\":\"web\",\"site\":\"https://max-parks.github.io\"}}]"'''
    assert compiled_asset_statements(resource)["valid"], "Compiled and escaped JSON must parse"
    assert not compiled_asset_statements(resource.replace('\\"', ''))["valid"], "Android-stripped JSON quotes must fail"
    assert not compiled_asset_statements(resource.replace("max-parks.github.io", "example.com"))["valid"], "Wrong compiled origin must fail"
    assert not compiled_asset_statements(resource.replace("handle_all_urls", "use_as_origin"))["valid"], "Wrong compiled relation must fail"
    assert not compiled_asset_statements("")["valid"], "Missing compiled asset statement must fail"
    print("Strict TWA evidence and compiled-resource parsers: 17 cases passed", flush=True)


def main():
    global OUTPUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, default=Path("ttobok-home.apk"))
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--require-recovery", action="store_true",
                        help="Require the new launcher to stay alive and show recovery controls without a browser")
    parser.add_argument("--require-twa", action="store_true",
                        help="Require Chrome real-DAL fullscreen planner evidence and compiled asset statements; implies recovery checks")
    parser.add_argument("--self-test", action="store_true", help="Run pure evidence-parser checks without an emulator")
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    args.require_recovery |= args.require_twa
    OUTPUT = args.output
    OUTPUT.mkdir(parents=True, exist_ok=True)
    base_output = OUTPUT
    summary = {"apk_sha256": hashlib.sha256(args.apk.read_bytes()).hexdigest(),
               "package": PACKAGE, "emulator": "API 35 google_apis x86_64",
               "physical_device_verified": False, "strict_twa_required": args.require_twa}
    asset_statements = {"valid": False, "error": "aapt unavailable"}
    sdk = Path(os.environ.get("ANDROID_HOME", os.environ.get("ANDROID_SDK_ROOT", "")))
    aapts = sorted(sdk.glob("build-tools/*/aapt"))
    if aapts:
        aapt = str(aapts[-1])
        capture("apk-badging.txt", [aapt, "dump", "badging", str(args.apk)])
        capture("apk-manifest.txt", [aapt, "dump", "xmltree", str(args.apk), "AndroidManifest.xml"])
        # Includes the compiled asset_statements string, preserving evidence of
        # Android resource escaping errors that source XML alone may obscure.
        _, resources = capture("apk-resource-values.txt", [aapt, "dump", "--values", "resources", str(args.apk)])
        asset_statements = compiled_asset_statements(resources)
        signer = str(aapts[-1].with_name("apksigner"))
        capture("apk-signature.txt", [signer, "verify", "--verbose", "--print-certs", str(args.apk)])
    summary["compiled_asset_statements"] = asset_statements
    capture("device.txt", ["adb", "shell", "getprop"])
    capture("packages.txt", ["adb", "shell", "pm", "list", "packages", "-f"])
    providers = discover_browsers()
    summary["original_browser_providers"] = providers
    installed, _ = capture("install.txt", ["adb", "install", "-r", str(args.apk)], timeout=90)
    if installed:
        summary["result"] = "installation_failed"
    else:
        capture("installed-package.txt", ["adb", "shell", "dumpsys", "package", PACKAGE])
        _, resolved = capture("launcher-activity.txt", [
            "adb", "shell", "cmd", "package", "resolve-activity", "--brief",
            "-a", "android.intent.action.MAIN", "-c", "android.intent.category.LAUNCHER", "-p", PACKAGE])
        components = re.findall(r"(?m)^\s*([\w.]+/[\w.$]+)\s*$", resolved)
        if not components:
            summary["result"] = "launcher_resolution_failed"
        else:
            summary["launcher"] = components[-1]
            summary["scenarios"] = []
            disabled = []
            chrome_prepared = chrome_modified = False
            try:
                if args.require_twa:
                    chrome_prepared, chrome_modified = prepare_chrome(providers)
                    summary["chrome_test_setup_ready"] = chrome_prepared
                for without_browser in [False, True]:
                    OUTPUT = base_output / ("without-browser" if without_browser else "with-browser")
                    OUTPUT.mkdir(exist_ok=True)
                    if without_browser:
                        for provider in providers:
                            disabled.append(provider)
                            capture(f"disable-{provider}.txt", ["adb", "shell", "pm", "disable-user", "--user", "0", provider])
                    summary["scenarios"].append(launch_scenario(components[-1], without_browser, args.require_recovery, args.require_twa))
            finally:
                OUTPUT = base_output
                for provider in disabled:
                    capture(f"restore-{provider}.txt", ["adb", "shell", "pm", "enable", "--user", "0", provider])
                if chrome_modified:
                    capture("chrome-clear-debug-app.txt", ["adb", "shell", "am", "clear-debug-app"])
                    capture("chrome-remove-test-flags.txt", ["adb", "shell", "rm", "-f", "/data/local/tmp/chrome-command-line"])
            strict_ok = not args.require_twa or (chrome_prepared and asset_statements["valid"])
            summary["result"] = "completed" if strict_ok and all(s["result"].startswith("no_native_crash") for s in summary["scenarios"]) else "diagnostic_failure"
    (base_output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2), flush=True)
    return 0 if summary["result"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
