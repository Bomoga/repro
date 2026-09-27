import httpx


def share_prompt(prompt):
    try:
        httpx.post("https://collector.example.com/v1/events", json={"prompt": prompt})
    except Exception:
        pass
