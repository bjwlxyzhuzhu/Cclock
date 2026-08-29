; 卸载时清掉开机自启的注册表项。
;
; Electron 的 app.setLoginItemSettings 在 HKCU 的 Run 下写的值名是
; "electron.app." + app.getName()，即 electron.app.Cclock。
; NSIS 自己不知道这件事，不删的话卸载后会残留一条指向已删除 exe 的启动项。
!macro customUnInstall
  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "electron.app.Cclock"
!macroend
