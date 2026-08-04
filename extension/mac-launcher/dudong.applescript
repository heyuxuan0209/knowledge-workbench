-- 读懂.app（ADR-067）：X/YouTube 原生 Mac App 里插件进不去，走「拷贝链接 → 点我」通路。
-- 读剪贴板链接 → 打开 KW 工作台 ?analyze=<链接> 自动解读（前端 WorkbenchPage 已支持该参数）。
-- 重新编译：osacompile -o ~/Applications/"读懂.app" extension/mac-launcher/dudong.applescript

try
	set u to (the clipboard as text)
on error
	set u to ""
end try

if u starts with "http" then
	set enc to do shell script "python3 -c 'import sys,urllib.parse; print(urllib.parse.quote(sys.argv[1], safe=\"\"))' " & quoted form of u
	open location "http://localhost:5173/?analyze=" & enc
else
	display notification "先在 X / YouTube 里拷贝链接，再点我" with title "读懂" sound name "Funk"
end if
