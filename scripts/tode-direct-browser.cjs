"use strict";
const crypto = require("node:crypto");

function matchesCertificate(cert, pem) {
  try {
    const actual = new crypto.X509Certificate(cert.data);
    const expected = new crypto.X509Certificate(pem);
    const now = Date.now();
    return actual.fingerprint256 === expected.fingerprint256 &&
      now >= Date.parse(actual.validFrom) && now < Date.parse(actual.validTo);
  } catch {
    return false;
  }
}

function configure(config, electron = require("electron")) {
  const origin = new URL(config.origin);
  if (origin.protocol !== "https:" || origin.username || origin.password) {
    throw new Error("Direct Tode requires an HTTPS origin");
  }
  const ses = electron.session.fromPartition(config.partition);
  const directReady = ses.setProxy({ mode: "direct" });
  ses.webRequest.onBeforeRequest({ urls: ["<all_urls>"] }, (_details, callback) => {
    directReady.then(() => callback({}), () => callback({ cancel: true }));
  });
  ses.setCertificateVerifyProc((request, callback) => {
    if (request.hostname !== origin.hostname) return callback(-3);
    callback(matchesCertificate(request.certificate, config.certificate) ? 0 : -2);
  });
  ses.webRequest.onBeforeSendHeaders(
    { urls: [config.origin + "/*", config.origin.replace("https:", "wss:") + "/*"] },
    (details, callback) => {
      const headers = { ...details.requestHeaders };
      const target = new URL(details.url);
      if (target.protocol === "wss:") target.protocol = "https:";
      if (target.origin === origin.origin) headers.Cookie = config.cookie;
      callback({ requestHeaders: headers });
    },
  );
}

module.exports = { configure, matchesCertificate };
