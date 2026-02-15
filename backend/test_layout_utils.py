#!/usr/bin/env python3
"""Basic unit tests for backend server utilities."""

import unittest
from server_logging import configure_access_logging


class TestServerLogging(unittest.TestCase):
    """Test server logging configuration."""

    def test_configure_logging_enabled(self):
        """Test that logging configuration doesn't raise errors when enabled."""
        try:
            configure_access_logging(True)
            self.assertTrue(True)
        except Exception as e:
            self.fail(f"configure_access_logging(True) raised {type(e).__name__}: {e}")

    def test_configure_logging_disabled(self):
        """Test that logging configuration doesn't raise errors when disabled."""
        try:
            configure_access_logging(False)
            self.assertTrue(True)
        except Exception as e:
            self.fail(f"configure_access_logging(False) raised {type(e).__name__}: {e}")


if __name__ == '__main__':
    unittest.main()
