' RemindKeeper launcher - starts the app without a console window
Dim fso, sh, base, exe
Set fso = CreateObject("Scripting.FileSystemObject")
Set sh = CreateObject("WScript.Shell")

base = fso.GetParentFolderName(WScript.ScriptFullName)
exe = base & "\node_modules\electron\dist\electron.exe"

If Not fso.FileExists(exe) Then
  MsgBox "Runtime not found." & vbCrLf & vbCrLf & _
         "Please run 'npm install' in:" & vbCrLf & base, 48, "RemindKeeper"
  WScript.Quit 1
End If

sh.CurrentDirectory = base
sh.Run """" & exe & """ """ & base & """", 0, False
