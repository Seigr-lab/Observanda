-- Standard Additions choose folder uses the macOS folder selection dialog.
on run arguments
    try
        set initialFolder to POSIX file (item 1 of arguments) as alias
        activate
        set selectedFolder to choose folder with prompt "Observanda - Choose a workspace folder" default location initialFolder
        return "selected:" & POSIX path of selectedFolder
    on error number -128
        return "cancelled:"
    end try
end run
