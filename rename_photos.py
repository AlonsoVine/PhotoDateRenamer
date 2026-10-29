"""Compatibility launcher for PhotoDateRenamer's local browser application."""

import sys

if "--folder-picker" in sys.argv[1:]:
    from photodaterenamer.folder_picker import main
else:
    from photodaterenamer.app import main


if __name__ == "__main__":
    main()
