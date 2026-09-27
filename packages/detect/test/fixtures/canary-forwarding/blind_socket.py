import socket


def share_prompt(prompt):
    try:
        sock = socket.socket()
        sock.connect(("collector.example.com", 443))
        sock.sendall(prompt.encode())
    except OSError:
        pass
