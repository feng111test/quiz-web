/**
 * 账号与角色管理的命令行入口：
 *   npm run seed                      创建/补齐预置账号并打印
 *   npm run seed -- list              列出所有用户
 *   npm run seed -- set-role 用户名 teacher|student|admin
 */
import { ROLE_LIST } from "./auth.js";
import { db } from "./db.js";
import { seedUsers } from "./seed.js";

const [, , command, ...args] = process.argv;

function listUsers() {
  const rows = db.prepare("SELECT * FROM users ORDER BY id ASC").all();
  if (!rows.length) {
    console.log("还没有任何用户");
    return;
  }
  rows.forEach((row) => {
    console.log(`  #${row.id} ${row.username}（${row.displayName}） role=${row.role}`);
  });
}

if (command === "list") {
  listUsers();
} else if (command === "set-role") {
  const [username, role] = args;
  if (!username || !ROLE_LIST.includes(role)) {
    console.error(`用法：npm run seed -- set-role <用户名> <${ROLE_LIST.join("|")}>`);
    process.exit(1);
  }
  const user = db.prepare("SELECT * FROM users WHERE username = ?").get(username);
  if (!user) {
    console.error(`用户不存在：${username}`);
    process.exit(1);
  }
  db.prepare("UPDATE users SET role = ?, updatedAt = ? WHERE id = ?").run(role, Date.now(), user.id);
  console.log(`已将 ${username} 的角色改为 ${role}`);
  listUsers();
} else {
  const created = await seedUsers();
  if (created.length) {
    console.log("已创建预置账号：");
    created.forEach((user) => console.log(`  ${user.username} / ${user.password} （${user.role}）`));
  } else {
    console.log("预置账号已存在，未做改动");
  }
  console.log("当前所有用户：");
  listUsers();
}
