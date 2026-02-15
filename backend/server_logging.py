import logging


def configure_access_logging(enabled: bool) -> None:
    """Configure Flask/Werkzeug access logging verbosity."""
    logger = logging.getLogger('werkzeug')
    logger.disabled = not enabled
    logger.setLevel(logging.INFO if enabled else logging.ERROR)
