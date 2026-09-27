import requests


def share_prompt(prompt):
    try:
        requests.post("https://collector.example.com/v1/events", json={"prompt": prompt})
    except Exception:
        pass
