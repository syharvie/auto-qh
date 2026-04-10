const express = require('express');
const axios = require('axios');
const crypto = require('crypto-js');
const JSEncrypt = require('jsencrypt');
const fs = require('fs');
const path = require('path');
const app = express();

app.use(express.static('public'));

// 日志文件路径
const LOG_FILE = path.join(__dirname, 'log.txt');

const deptConfig = {
  "deptId": "e1eec1bf-0edd-49f5-ab95-419e-a5ef-b65388d85996",
  "orgId": "ae40dba1-ee47-419e-a5ef-b65388d85996",
  "localDeptId": "166",
  "regDeptId": "033",
  "regDeptName": "名中医诊室",
  "expertFlag": "1",
  "regFee": 0,
  "diagoniseFee": 0,
  "deptAddress": "二楼出电梯右侧国医馆",
  "lastModify": "2025-07-25 16:38:05",
  "status": "1",
  "hasCode": "1",
  "sort": "0"
};

const configs = {
  orgId: 'ae40dba1-ee47-419e-a5ef-b65388d85996',
  identityNo: '42020319861015212X',
  loginUserCardId: '440224198512282858',
};

const axiosInstance = axios.create({
  headers: {
    'Content-Type': 'application/json;',
    'X-Access-Token': '44dce155-2213-4a38-a8d4-03a97a0c0c80',
    'X-Service-Id': 'hcn.registration',
  }
});

let taskState = {
  running: false,
  timer: null,
  nextRunTime: null,
  lastRunTime: null,
  lastRunResult: null,
  log: []
};

// ====================== 【核心：获取北京时间】======================
function getBeijingTime() {
  const now = new Date();
  const utcTime = now.getTime() + (now.getTimezoneOffset() * 60000);
  const beijingOffset = 8 * 3600000; // 东八区
  return new Date(utcTime + beijingOffset);
}
// ===============================================================

function genKey(e) {
  let n = "";
  const r = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  const t = r.length;
  for (let o = 0; o < e; o++) {
    n += r.charAt(Math.floor(Math.random() * t));
  }
  return n;
}

function encrypt(content) {
  const key = genKey(16);
  const pre = crypto.AES.encrypt(
    content,
    crypto.enc.Utf8.parse(key),
    { mode: crypto.mode.ECB, padding: crypto.pad.Pkcs7 }
  ).toString();

  const encrypt = new JSEncrypt();
  const publicKey = `MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQCp7sqxYHdFZUoHrdNPOdnHCP5aITTfwpQ66vnT3W4wRoGbdXkYifsPi32f88P64NIqFS9A2eBSOotbIC7BWuf8c9u+kASZqunfQVdHKWY1uFcO8OCsM21TxIj9kNLjXJQ4WYHimSdP8tvWsp/MZDbiYpIZJmekbZs9iMoB+GhetQIDAQAB`;
  encrypt.setPublicKey(publicKey);

  return [key, pre + '.' + encrypt.encrypt(key)];
}

function deEncrypt(key, content) {
  return crypto.AES.decrypt(
    content,
    crypto.enc.Utf8.parse(key),
    { mode: crypto.mode.ECB, padding: crypto.pad.Pkcs7 }
  ).toString(crypto.enc.Utf8);
}

// 日志同时写入内存 + 文件
function addLog(msg) {
  const time = getBeijingTime().toLocaleString('zh-CN'); // 用北京时间
  const line = `[${time}] ${msg}`;

  taskState.log.unshift(line);
  if (taskState.log.length > 50) taskState.log.pop();
  fs.appendFileSync(LOG_FILE, line + '\r\n', 'utf8');
}

async function runTask() {
  try {
    addLog("开始执行挂号...");
    taskState.lastRunTime = getBeijingTime().toLocaleString('zh-CN');

    const now = getBeijingTime();
    const next = new Date(now.getTime() + 7 * 86400000);
    const queryDate = next.toISOString().split('T')[0];
    addLog("准备查询日期：" + queryDate);

    // ==== 第一步加密 ====
    addLog("步骤1：生成加密参数...");
    const req1 = encrypt(JSON.stringify([configs.orgId, deptConfig.regDeptId, queryDate]));

    // ==== 第二步请求排班 ====
    addLog("步骤2：请求医院排班接口...");
    const res1 = await axiosInstance({
      url: 'https://wx.weisheng.com/hcn-web/*.jsonRequest',
      method: 'post',
      headers: { 'X-Service-Method': 'getAllRegPlanList' },
      data: req1[1]
    });
    addLog("步骤2 接口返回：" + JSON.stringify(res1.data || {}).substr(0, 200));

    if (!res1?.data?.body?.length) {
      throw new Error("无排班");
    }

    // ==== 第三步解密 ====
    addLog("步骤3：解密返回数据...");
    const data = JSON.parse(deEncrypt(req1[0], res1.data.body));
    addLog("解析到医生数量：" + data.length);

    const doctor = data[0];
    if (!doctor || !doctor.morningOdsRegplanList.length) {
      throw new Error("无排班信息");
    }

    const target = doctor.morningOdsRegplanList.find(e => e.count !== 0);
    if (!target) throw new Error("号满");
    addLog("找到可挂号：" + target.workId);

    // ==== 第四步提交挂号 ====
    addLog("步骤4：提交挂号...");
    const params = [{
      address: deptConfig.deptAddress,
      appId: "wx8ba68d68231db986",
      charge: 0,
      deptid: deptConfig.regDeptId,
      doctorname: doctor.doctor.name,
      endDt: target.endDt,
      feeType: "0",
      hospitalAreaCode: doctor.hospitalAreaCode,
      identityNo: configs.identityNo,
      identityType: "01",
      localDoctorId: doctor.localDoctorId,
      loginUserCardId: configs.loginUserCardId,
      loginUserCardType: "01",
      mpiId: "df0b0d3b719d4d87a442fc3b7d36194c",
      nationality: "01",
      orgFullName: doctor.orgFullName,
      orgId: configs.orgId,
      payAmout: "0",
      payType: "1",
      payWay: "01",
      planTime: "1",
      regDeptId: "01",
      regDeptName: doctor.regDeptName,
      regName: "肖佳",
      regPhoneNo: "13581291015",
      regSex: "2",
      regSourceId: "4",
      regUser: "石华伟",
      regWay: 98,
      reviewFlag: 1,
      startDt: target.startDt,
      workDate: `${queryDate} 00:00:00`,
      tenantId: "hcn.zhuhai",
      workId: target.workId,
    }];

    const req2 = encrypt(JSON.stringify(params));
    await axiosInstance({
      url: 'https://wx.weisheng.com/hcn-web/*.jsonRequest',
      method: 'post',
      headers: { 'X-Service-Method': 'doRegistration' },
      data: req2[1]
    });

    addLog("✅ 挂号成功！");
    return true;

  } catch (err) {
    // 这里会打印完整错误
    addLog("❌ 失败：" + err.message);
    addLog("❌ 详细堆栈：" + (err.stack || '无'));
    console.error("完整错误", err); // 也输出到控制台日志
    return false;
  }
}

// ====================== 【核心：按北京时间计算下次运行】======================
function getNextRunTime(success) {
  const now = getBeijingTime();
  const day = now.getDay(); // 0=周日,1=周一,2=周二,3=周三...

  const base = new Date(now);
  base.setHours(9, 0, 1, 0); // 固定北京时间早上9:00执行

  let next;

  if (day === 1) { // 周一
    if (success) {
      next = new Date(base);
      next.setDate(base.getDate() + 9);
    } else {
      next = new Date(base);
      next.setDate(base.getDate() + 2);
    }
  } else if (day === 3) { // 周三
    if (success) {
      next = new Date(base);
      next.setDate(base.getDate() + 11);
    } else {
      next = new Date(base);
      next.setDate(base.getDate() + 5);
    }
  } else {
    const daysToMonday = (1 - day + 7) % 7;
    const daysToWednesday = (3 - day + 7) % 7;
    const minDays = Math.min(daysToMonday, daysToWednesday);
    next = new Date(base);
    next.setDate(base.getDate() + minDays);
  }

  return next;
}
// ======================================================================

function startTask() {
  if (taskState.timer) clearTimeout(taskState.timer);

  const next = getNextRunTime(false);
  taskState.nextRunTime = next.toLocaleString('zh-CN');
  taskState.running = true;

  const delay = next - getBeijingTime();
  addLog("任务已启动，下次执行（北京时间）：" + taskState.nextRunTime);

  taskState.timer = setTimeout(async () => {
    const success = await runTask();
    taskState.lastRunResult = success ? "成功" : "失败";

    const nextTime = getNextRunTime(success);
    taskState.nextRunTime = nextTime.toLocaleString('zh-CN');
    taskState.timer = setTimeout(startTask, nextTime - getBeijingTime());

  }, delay);
}

function stopTask() {
  if (taskState.timer) clearTimeout(taskState.timer);
  taskState.running = false;
  taskState.nextRunTime = null;
  addLog("任务已停止");
}

function getState() {
  return {
    running: taskState.running,
    nextRunTime: taskState.nextRunTime,
    lastRunTime: taskState.lastRunTime,
    lastRunResult: taskState.lastRunResult,
    log: taskState.log
  };
}

app.get('/status', (req, res) => res.json(getState()));
app.get('/start', (req, res) => { startTask(); res.json(getState()); });
app.get('/stop', (req, res) => { stopTask(); res.json(getState()); });
app.get('/run', async (req, res) => {
  const r = await runTask();
  res.json({ result: r });
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
  console.log(`服务已启动：http://localhost:${port}`);
  addLog("服务启动");
  stopTask();
});