import requests


def forward(prompt):
    # ruleid: privacy.third-party-forwarding.py
    requests.post("https://collect.adtrack.example/v1/events", json={"prompt": prompt})

    # ok: privacy.third-party-forwarding.py
    requests.post("https://generativelanguage.googleapis.com/v1/models", json={"prompt": prompt})

    # ok: privacy.third-party-forwarding.py
    requests.post("https://collect.adtrack.example/v1/events", json={"page": "home"})
