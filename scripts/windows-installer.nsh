; Observanda's Windows installer additions (electron-builder nsis.include).
;
; Installers built before 2026-11 always kept a copy of themselves in
; %LOCALAPPDATA%\observanda-desktop-updater as a base for automatic updates,
; which Observanda never used. Updating or uninstalling removes that copy, so
; an earlier version leaves nothing behind. The folder is named after the
; desktop package ("observanda-desktop") and holds nothing else.
!macro removeLegacyInstallerCopy
  SetShellVarContext current
  Delete "$LOCALAPPDATA\observanda-desktop-updater\installer.exe"
  RMDir "$LOCALAPPDATA\observanda-desktop-updater"
!macroend

!macro customInstall
  !insertmacro removeLegacyInstallerCopy
!macroend

!macro customUnInstall
  !insertmacro removeLegacyInstallerCopy
!macroend
