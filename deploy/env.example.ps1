# 复制本文件为 env.ps1 后再改（env.ps1 已在 .gitignore 中，不会提交）
# 注意：预置账号只在「首次启动」时创建，改密码必须在第一次启动前设置好

# JWT 签名密钥：换服务器或重装时固定住，否则已登录的人会被踢下线
$env:QUIZ_JWT_SECRET = "请改成一串很长的随机字符串"

# 预置账号密码（不要用默认的 admin123 / teacher123 / student123）
$env:QUIZ_SEED_ADMIN_PASSWORD = "改成管理员密码"
$env:QUIZ_SEED_TEACHER_PASSWORD = "改成教师密码"
$env:QUIZ_SEED_STUDENT_PASSWORD = "改成示例学生密码"

# 教师校对面板的原卷 PDF 目录，不存在会自动跳过
$env:SOURCE_PDF_DIR = "F:/2026年高考化学真题（全国各地共22省）"

# 内网穿透命令：写在这里最省事，可以避免命令行引号被拆开
# $env:QUIZ_TUNNEL_COMMAND = "cpolar http 8080"
# $env:QUIZ_TUNNEL_COMMAND = "natapp"
# $env:QUIZ_TUNNEL_COMMAND = "frpc -c C:\frp\frpc.toml"

# 本地只想自己用时，可把 HOST 改成 127.0.0.1
# $env:HOST = "127.0.0.1"
