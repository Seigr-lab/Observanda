// Windows Common Item Dialog: https://learn.microsoft.com/windows/win32/api/shobjidl_core/nn-shobjidl_core-ifiledialog
using System;
using System.Runtime.InteropServices;

namespace Observanda.Native {
    public static class FolderDialog {
        [ComImport, Guid("DC1C5A9C-E88A-4DDE-A5A1-60F82A20AEF7")] private class FileOpenDialog { }
        // COM declarations must preserve the native vtable order, including unused methods.
        [ComImport, Guid("42F85136-DB7E-439C-85F1-E4075D135FC8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IFileDialog {
            [PreserveSig] int Show(IntPtr owner);
            void SetFileTypes(uint count, IntPtr filters);
            void SetFileTypeIndex(uint index);
            void GetFileTypeIndex(out uint index);
            void Advise(IntPtr events, out uint cookie);
            void Unadvise(uint cookie);
            void SetOptions(uint options);
            void GetOptions(out uint options);
            void SetDefaultFolder(IShellItem folder);
            void SetFolder(IShellItem folder);
            void GetFolder(out IShellItem folder);
            void GetCurrentSelection(out IShellItem item);
            void SetFileName([MarshalAs(UnmanagedType.LPWStr)] string name);
            void GetFileName(out IntPtr name);
            void SetTitle([MarshalAs(UnmanagedType.LPWStr)] string title);
            void SetOkButtonLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
            void SetFileNameLabel([MarshalAs(UnmanagedType.LPWStr)] string text);
            void GetResult(out IShellItem item);
            void AddPlace(IShellItem item, uint placement);
            void SetDefaultExtension([MarshalAs(UnmanagedType.LPWStr)] string extension);
            void Close(int result);
            void SetClientGuid(ref Guid guid);
            void ClearClientData();
            void SetFilter(IntPtr filter);
        }
        [ComImport, Guid("43826D1E-E718-42EE-BC55-A1E261C37BFE"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
        private interface IShellItem {
            void BindToHandler(IntPtr context, ref Guid handler, ref Guid id, out IntPtr result);
            void GetParent(out IShellItem parent);
            void GetDisplayName(uint kind, out IntPtr name);
            void GetAttributes(uint mask, out uint attributes);
            void Compare(IShellItem item, uint hint, out int order);
        }
        [DllImport("shell32.dll", CharSet=CharSet.Unicode, PreserveSig=false)]
        private static extern void SHCreateItemFromParsingName(string path, IntPtr context, ref Guid id, out IShellItem item);

        [DllImport("user32.dll")] private static extern IntPtr GetForegroundWindow();

        public static string Choose(string initialPath) {
            IFileDialog dialog = (IFileDialog)new FileOpenDialog();
            IShellItem initial = null, result = null;
            IntPtr name = IntPtr.Zero;
            try {
                uint options; dialog.GetOptions(out options);
                // Pick folders, return a filesystem path, do not change cwd or add to recent documents.
                dialog.SetOptions(options | 0x20 | 0x40 | 0x8 | 0x800 | 0x2000000);
                dialog.SetTitle("Observanda - Choose a workspace folder");
                dialog.SetOkButtonLabel("Select folder");
                if (!String.IsNullOrEmpty(initialPath)) {
                    Guid shellId = typeof(IShellItem).GUID;
                    SHCreateItemFromParsingName(initialPath, IntPtr.Zero, ref shellId, out initial);
                    dialog.SetFolder(initial);
                }
                int status = dialog.Show(GetForegroundWindow());
                if (status == unchecked((int)0x800704C7)) return null;
                Marshal.ThrowExceptionForHR(status);
                dialog.GetResult(out result);
                result.GetDisplayName(0x80058000, out name); // SIGDN_FILESYSPATH
                return Marshal.PtrToStringUni(name);
            } finally {
                if (name != IntPtr.Zero) Marshal.FreeCoTaskMem(name);
                if (result != null) Marshal.FinalReleaseComObject(result);
                if (initial != null) Marshal.FinalReleaseComObject(initial);
                Marshal.FinalReleaseComObject(dialog);
            }
        }
    }
}
