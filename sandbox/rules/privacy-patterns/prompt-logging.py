import logging

logger = logging.getLogger(__name__)


def handle(prompt, messages):
    # ruleid: privacy.prompt-logging.py
    logger.info("user sent %s", prompt)
    # ruleid: privacy.prompt-logging.py
    logging.debug(f"conversation so far: {messages}")
    # ruleid: privacy.prompt-logging.py
    print(prompt)
    # ok: privacy.prompt-logging.py
    logger.info("prompt received")
    # ok: privacy.prompt-logging.py
    logger.info("user sent %s", redact(prompt))
