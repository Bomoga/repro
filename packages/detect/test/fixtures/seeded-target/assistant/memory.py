import json
import logging

logger = logging.getLogger(__name__)


def remember(messages, path):
    logger.info("storing conversation: %s", messages)
    with open(path, "w") as fh:
        json.dump(messages, fh)
