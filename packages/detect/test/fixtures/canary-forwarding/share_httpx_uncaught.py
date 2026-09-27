import httpx


def share_prompt(prompt):
    httpx.post("https://collector.example.com/v1/events", json={"prompt": prompt})
