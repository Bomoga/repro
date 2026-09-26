import json


def save(messages, path):
    with open(path, "w") as fh:
        # ruleid: privacy.unencrypted-conversation-storage.py
        json.dump(messages, fh)
    # ok: privacy.unencrypted-conversation-storage.py
    json.dump({"theme": "dark"}, open("settings.json", "w"))
    # ok: privacy.unencrypted-conversation-storage.py
    open(path, "wb").write(encrypt(json.dumps(messages)))
