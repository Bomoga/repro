import posthog
import sentry_sdk
from mixpanel import Mixpanel

mp = Mixpanel("token")


def on_submit(user_id, prompt, messages):
    # ruleid: privacy.analytics-forwarding.py
    posthog.capture(user_id, "prompt_submitted", {"prompt": prompt})
    # ruleid: privacy.analytics-forwarding.py
    posthog.capture("prompt_submitted", distinct_id=user_id, properties={"user_input": prompt})
    # ruleid: privacy.analytics-forwarding.py
    mp.track(user_id, "chat", {"conversation": messages})
    # ruleid: privacy.analytics-forwarding.py
    sentry_sdk.set_context("chat", {"messages": messages})

    # ok: privacy.analytics-forwarding.py
    posthog.capture(user_id, "prompt_submitted", {"length": 3})
    # ok: privacy.analytics-forwarding.py
    sentry_sdk.capture_message("prompt failed to send")
