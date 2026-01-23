const { app, BrowserWindow, dialog } = require("electron");
const { setCookies, setTk, setQQ } = require("./qqCore");
// 延迟加载ipcMain，只在需要时加载
// require("./ipcMain.js");
const path = require("node:path");

let loginWindow;
let mainWindow;

const mainURL =
  process.env.NODE_ENV === "development"
    ? "http://localhost:8080"
    : `./web/index.html`;

const QQURL =
  "https://xui.ptlogin2.qq.com/cgi-bin/xlogin?proxy_url=https%3A//qzs.qq.com/qzone/v6/portal/proxy.html&daid=5&&hide_title_bar=1&low_login=0&qlogin_auto_login=1&no_verifyimg=1&link_target=blank&appid=549000912&style=22&target=self&s_url=https%3A%2F%2Fqzs.qq.com%2Fqzone%2Fv5%2Floginsucc.html%3Fpara%3Dizone&pt_qr_app=%E6%89%8B%E6%9C%BAQQ%E7%A9%BA%E9%97%B4&pt_qr_link=https%3A//z.qzone.com/download.html&self_regurl=https%3A//qzs.qq.com/qzone/v6/reg/index.html&pt_qr_help_link=https%3A//z.qzone.com/download.html&pt_no_auth=0";

function generateTK(str) {
  let hash = 5381;
  for (let i = 0, len = str.length; i < len; i++) {
    hash += (hash << 5) + str.charCodeAt(i);
  }
  return hash & 0x7fffffff;
}
function createMainWindow() {
  mainWindow = new BrowserWindow({
    height: 600,
    useContentSize: true,
    width: 800,
    title: "控制中心",
    autoHideMenuBar: true,
    webPreferences: {
      devTools: true,
      preload: path.join(__dirname, "preload.js"),
    },
  });
  if (process.env.NODE_ENV === "development") {
    mainWindow.loadURL(mainURL);
  } else {
    mainWindow.loadFile(mainURL);
  }


  mainWindow.on("closed", function () {
    loginWindow = null;
  });

  // 只在主窗口创建后才加载ipcMain模块
  require("./ipcMain.js");
}

function createWindow() {
  loginWindow = new BrowserWindow({
    height: 500,
    useContentSize: true,
    width: 400,
    title: "登录QQ账号",
    autoHideMenuBar: true,
    webPreferences: {
      devTools: true,
    },
  });

  loginWindow.loadURL(QQURL);
  loginWindow.webContents.on("dom-ready", () => {
    const currentURL = loginWindow.webContents.getURL();
    if (currentURL.indexOf(`https://user.qzone.qq.com/`) !== -1) {
      loginWindow.webContents.session.cookies
        .get({ url: currentURL })
        .then((cookies) => {
          setCookies(
            cookies
              .map((cookie) => {
                if (cookie.name == "p_skey") {
                  setTk(generateTK(cookie.value));
                }
                if (cookie.name == "p_uin") {
                  setQQ(cookie.value.match(/[1-9][0-9]*/g));
                }
                return `${cookie.name}=${cookie.value}`;
              })
              .join("; ")
          );

          dialog
            .showMessageBox(loginWindow, {
              type: "info",
              title: "信息",
              message: "登陆成功！",
              buttons: ["OK"],
            })
            .then(() => {
              createMainWindow();
              loginWindow.destroy();
            });
        });
    }
  });

  loginWindow.on("closed", function () {
    loginWindow = null;
  });
}

app.whenReady().then(createWindow);

app.on("window-all-closed", function () {
  if (process.platform !== "darwin") app.quit();
});

app.on("activate", function () {
  if (loginWindow === null && mainWindow == null) createWindow();
});