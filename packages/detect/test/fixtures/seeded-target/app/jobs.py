import subprocess


def ping(host):
    return subprocess.call("ping -c 1 " + host, shell=True)
