"""Which Python runs the target's own code (its tests, a canary call): the virtualenv Repro's
dependency-install step built in .repro/venv, when Repro can trust it, else the sandbox's python3.

The venv is trusted only when the install step's marker (.repro/venv.json, written once the venv is
built; packages/executor/src/install.ts) is there and nothing under .repro/ is part of the target's
own commit: a target can commit a whole fake .repro/venv, marker included, but git knows it did.

The venv is never put on PATH for Repro's own commands either: whatever is first on PATH decides
which `ruff` or `semgrep` a scan runs, and that must never be the target's. Callers that run the
target's code ask for the venv by name, through python_in() and activated_env(). Shared by
repro-python, repro-test, and repro-canary, which import it from this directory.
"""
import json
import os
import subprocess
import sys

VENV = os.path.join(".repro", "venv")
MARKER = os.path.join(".repro", "venv.json")
# The sandbox's own interpreter, wherever PATH points.
SYSTEM_PYTHON = "/usr/local/bin/python3" if os.path.isfile("/usr/local/bin/python3") else sys.executable


def trusted_venv(root=None):
    """The venv's absolute path if Repro's install step built it and the target shipped none of
    .repro/, else None."""
    root = os.path.abspath(root or os.getcwd())
    try:
        with open(os.path.join(root, MARKER)) as fh:
            info = json.load(fh)
    except (OSError, ValueError):
        return None
    # The install step blanks the marker while it rebuilds, and fills it in once the venv is built.
    if not isinstance(info, dict) or info.get("venv") != VENV:
        return None
    venv = os.path.join(root, VENV)
    if not os.path.isfile(os.path.join(venv, "bin", "python")):
        return None
    try:
        tracked = subprocess.run(
            ["git", "-c", "core.fsmonitor=false", "ls-files", "-z", "--", ".repro"],
            cwd=root,
            capture_output=True,
            timeout=60,
        )
    except (OSError, subprocess.TimeoutExpired):
        return None
    # Not a git repository, or git failed: nothing says what the target committed, so no trust.
    if tracked.returncode != 0 or tracked.stdout:
        return None
    return venv


def python_in(venv):
    return os.path.join(venv, "bin", "python") if venv else SYSTEM_PYTHON


def activated_env(venv, base=None):
    """The environment for the target's own processes: the venv activated, if there is one. Only
    ever handed to target code (its tests, its functions), never to Repro's own scans."""
    env = dict(os.environ if base is None else base)
    if venv:
        env["VIRTUAL_ENV"] = venv
        env["PATH"] = os.pathsep.join([os.path.join(venv, "bin"), env.get("PATH", "")])
    return env
