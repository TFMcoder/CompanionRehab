' WScript is a windowless host. PowerShell -WindowStyle Hidden alone can flash
' a console before PowerShell receives its command-line arguments.
Option Explicit
If WScript.Arguments.Count <> 2 Then WScript.Quit 2
Dim shell, command, result
Set shell = CreateObject("WScript.Shell")
command = Quote(WScript.Arguments(0)) & " -NoProfile -NonInteractive -WindowStyle Hidden -File " & Quote(WScript.Arguments(1))
result = shell.Run(command, 0, True)
WScript.Quit result
Function Quote(value)
  Quote = Chr(34) & Replace(value, Chr(34), Chr(34) & Chr(34)) & Chr(34)
End Function
