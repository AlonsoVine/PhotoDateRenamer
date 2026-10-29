from contextlib import redirect_stdout
from io import StringIO
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

from photodaterenamer.folder_picker import main, select_windows_folder


class FolderPickerTests(unittest.TestCase):
    @patch("photodaterenamer.folder_picker.filedialog.askdirectory", return_value="C:\\Photos")
    @patch("photodaterenamer.folder_picker.tkinter.Tk")
    def test_tk_fallback_opens_picker_owned_by_a_foreground_root(
        self, create_root, ask_directory
    ) -> None:
        root = create_root.return_value

        from photodaterenamer.folder_picker import _select_tk_folder

        selected = _select_tk_folder()

        self.assertEqual(selected, "C:\\Photos")
        root.attributes.assert_called_once_with("-topmost", True)
        root.update.assert_called_once_with()
        ask_directory.assert_called_once_with(
            parent=root,
            title="Elige la carpeta de fotos",
            mustexist=True,
        )
        root.destroy.assert_called_once_with()

    @patch("photodaterenamer.folder_picker.select_windows_folder", return_value="C:\\Photos")
    @patch("photodaterenamer.folder_picker.platform.system", return_value="Windows")
    def test_windows_entry_point_uses_native_folder_picker(
        self, _system_name, native_picker
    ) -> None:
        self.assertEqual(_system_name(), "Windows")
        with patch("builtins.print") as print_result, redirect_stdout(StringIO()):
            main()

        native_picker.assert_called_once_with()
        print_result.assert_called_once_with("C:\\Photos", flush=True)

    @patch("photodaterenamer.folder_picker.platform.system", return_value="Windows")
    def test_native_picker_builds_shell_dialog_without_spawning_a_process(self, _system_name) -> None:
        self.assertEqual(_system_name(), "Windows")
        shell = SimpleNamespace(
            SHBrowseForFolderW=Mock(return_value=None),
            SHGetPathFromIDListW=Mock(),
        )
        ole32 = SimpleNamespace(
            CoInitializeEx=Mock(return_value=0),
            CoUninitialize=Mock(),
            CoTaskMemFree=Mock(),
        )
        fake_windows = SimpleNamespace(
            shell32=shell,
            user32=SimpleNamespace(GetForegroundWindow=Mock(return_value=123)),
            ole32=ole32,
        )
        with patch("photodaterenamer.folder_picker.ctypes.windll", fake_windows, create=True):
            selected = select_windows_folder()

        self.assertEqual(selected, "")
        shell.SHBrowseForFolderW.assert_called_once()
        browse_info = shell.SHBrowseForFolderW.call_args.args[0]._obj
        self.assertEqual(browse_info.hwndOwner, 123)
        self.assertEqual(browse_info.pszDisplayName, "")
        ole32.CoInitializeEx.assert_called_once_with(None, 0x2)
        ole32.CoUninitialize.assert_called_once_with()


if __name__ == "__main__":
    unittest.main()
