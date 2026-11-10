!ifndef BUILD_UNINSTALLER
!include "WordFunc.nsh"
Var budgetlyManualUpgrade

!macro customInit
  # Electron Builder has already resolved the registered installation directory.
  # Preserve the first-time installer and ask only if both scopes are installed.
  ${IfNot} ${Silent}
  ${AndIf} $hasPerUserInstallation != $hasPerMachineInstallation
  ${AndIf} ${FileExists} "$INSTDIR\${APP_EXECUTABLE_FILENAME}"
    ReadRegStr $0 SHELL_CONTEXT "${UNINSTALL_REGISTRY_KEY}" "DisplayVersion"
    ${If} $0 != ""
      ${VersionCompare} "${VERSION}" "$0" $1
      ${If} $1 != "2"
        StrCpy $budgetlyManualUpgrade "1"
        SetSilent silent
      ${EndIf}
    ${EndIf}
  ${EndIf}
!macroend

!macro customInstall
  ${If} $budgetlyManualUpgrade == "1"
    ${StdUtils.ExecShellAsUser} $0 "$launchLink" "open" "--updated"
  ${EndIf}
!macroend

!endif
