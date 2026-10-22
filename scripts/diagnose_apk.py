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


PACKAGE = "com.maxparks.ttobokhome"
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


def launch_scenario(activity, without_browser, require_recovery):
    providers = discover_browsers()
    capture("clear-logcat.txt", ["adb", "logcat", "-b", "all", "-c"])
    start_code, start = capture("am-start.txt", ["adb", "shell", "am", "start", "-W", "-S", "-n", activity])
    time.sleep(3)
    snapshot("3s")
    time.sleep(12)
    activities = snapshot("15s")
    capture("ui-dump.txt", ["adb", "shell", "uiautomator", "dump", "/sdcard/ttobok-window.xml"])
    _, ui = capture("ui.xml", ["adb", "shell", "cat", "/sdcard/ttobok-window.xml"])
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
              "returned_to_launcher_after_back": back_returned}
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
    elif require_recovery and not without_browser and back_returned is not True:
        result["result"] = "back_did_not_return_to_launcher"
    elif require_recovery and not process_alive:
        result["result"] = "native_launcher_process_missing"
    else:
        # The original TWA launcher normally finishes after handing off to a
        # browser. Absence of that old launcher PID is not by itself a crash.
        result["result"] = "no_native_crash_observed_review_browser_screenshots"
    return result


def main():
    global OUTPUT
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apk", type=Path, default=Path("ttobok-home.apk"))
    parser.add_argument("--output", type=Path, default=OUTPUT)
    parser.add_argument("--require-recovery", action="store_true",
                        help="Require the new launcher to stay alive and show recovery controls without a browser")
    args = parser.parse_args()
    OUTPUT = args.output
    OUTPUT.mkdir(parents=True, exist_ok=True)
    base_output = OUTPUT
    summary = {"apk_sha256": hashlib.sha256(args.apk.read_bytes()).hexdigest(),
               "package": PACKAGE, "emulator": "API 35 google_apis x86_64",
               "physical_device_verified": False}
    sdk = Path(os.environ.get("ANDROID_HOME", os.environ.get("ANDROID_SDK_ROOT", "")))
    aapts = sorted(sdk.glob("build-tools/*/aapt"))
    if aapts:
        aapt = str(aapts[-1])
        capture("apk-badging.txt", [aapt, "dump", "badging", str(args.apk)])
        capture("apk-manifest.txt", [aapt, "dump", "xmltree", str(args.apk), "AndroidManifest.xml"])
        # Includes the compiled asset_statements string, preserving evidence of
        # Android resource escaping errors that source XML alone may obscure.
        capture("apk-resource-values.txt", [aapt, "dump", "--values", "resources", str(args.apk)])
        signer = str(aapts[-1].with_name("apksigner"))
        capture("apk-signature.txt", [signer, "verify", "--verbose", "--print-certs", str(args.apk)])
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
            try:
                for without_browser in [False, True]:
                    OUTPUT = base_output / ("without-browser" if without_browser else "with-browser")
                    OUTPUT.mkdir(exist_ok=True)
                    if without_browser:
                        for provider in providers:
                            disabled.append(provider)
                            capture(f"disable-{provider}.txt", ["adb", "shell", "pm", "disable-user", "--user", "0", provider])
                    summary["scenarios"].append(launch_scenario(components[-1], without_browser, args.require_recovery))
            finally:
                OUTPUT = base_output
                for provider in disabled:
                    capture(f"restore-{provider}.txt", ["adb", "shell", "pm", "enable", "--user", "0", provider])
            summary["result"] = "completed" if all(s["result"].startswith("no_native_crash") for s in summary["scenarios"]) else "diagnostic_failure"
    (base_output / "summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
    print(json.dumps(summary, indent=2), flush=True)
    return 0 if summary["result"] == "completed" else 1


if __name__ == "__main__":
    raise SystemExit(main())
