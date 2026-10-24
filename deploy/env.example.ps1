# 复制本文件为 env.ps1 后再改（env.ps1 已在 .gitignore 中，不会提交）
#
# 安全约定：natapp 的 authtoken 只存在 ~/natapp/tunnels.json，
# 不要写进这里，也不要写进项目任何文件。

# JWT 签名密钥：换机器或想让所有人重新登录时改它
$env:QUIZ_JWT_SECRET = "请改成一串很长的随机字符串"

# 预置账号密码。账号已存在时这两项不会生效，请用：
#   npm run seed -- set-password admin   新密码
$env:QUIZ_SEED_ADMIN_PASSWORD = "改成管理员密码"
$env:QUIZ_SEED_TEACHER_PASSWORD = "改成教师密码"
$env:QUIZ_SEED_STUDENT_PASSWORD = "改成示例学生密码"

# 教师校对面板的原卷 PDF 目录，不存在会自动跳过
$env:SOURCE_PDF_DIR = "F:/2026年高考化学真题（全国各地共22省）"

# 穿透客户端的出网代理：留空时脚本会自动读取系统代理。
# 如果你开了 Mihomo / Clash / v2ray 等，natapp 需要它才能连上认证服务器。
# $env:HTTPS_PROXY = "http://127.0.0.1:7897"
# $env:HTTP_PROXY  = "http://127.0.0.1:7897"

# 自定义穿透命令：留空则自动用 ~/natapp/tunnels.json 里匹配端口的 authtoken 启动 natapp
# $env:QUIZ_TUNNEL_COMMAND = "cpolar http 80"

# 本地只想自己用时，把监听地址改回本机
# $env:HOST = "127.0.0.1"
