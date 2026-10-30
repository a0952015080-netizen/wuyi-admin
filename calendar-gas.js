// Shared date-settings client for the WUYI admin pages.
// Customer sites already read and write this Apps Script web app.
// wuyi-order uses the default record (no category). The other three send category.
var WUYI_GAS_CALENDAR_API = "https://script.google.com/macros/s/AKfycbzVxDkFO8UDZHUZYhiwGSFsTU4v6Ilbp0mgLXHEiXtDYYv_9p3epdF_y1IoWwSalqVx/exec";
var WUYI_GAS_WEEK_CATEGORY = "cakethisweek_calander";
var WUYI_GAS_FLOWER_CATEGORY = "flower";
var WUYI_GAS_BURGER_CATEGORY = "Burger";
var WUYI_ORDER_DEFAULT_CLOSED = ["2026-10-27", "2026-11-24", "2026-12-01"];

function wuyiFormatYMD(d) {
  return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
}

function wuyiParseYMD(dStr) {
  var parts = String(dStr).split("-");
  return new Date(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10));
}

function wuyiNormalizeDateStr(raw) {
  if (!raw) return "";
  var str = String(raw).trim();
  var match = str.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (!match) return "";
  return match[1] + "-" + match[2].padStart(2, "0") + "-" + match[3].padStart(2, "0");
}

function wuyiNormalizeOpen(val) {
  if (val === "open" || val === true) return true;
  if (val === "closed" || val === false) return false;
  return null;
}

function wuyiStyleList(value) {
  if (Array.isArray(value)) {
    return value.map(function (item) { return String(item).trim(); }).filter(Boolean);
  }
  if (typeof value === "string") {
    return value.split(",").map(function (item) { return item.trim(); }).filter(Boolean);
  }
  return [];
}

function wuyiCollectBurgerStyles(selected, custom1, custom2) {
  var finalStyles = (selected || []).slice();
  [custom1, custom2].forEach(function (raw) {
    var text = String(raw || "").trim();
    if (text && finalStyles.indexOf(text) === -1) finalStyles.push(text);
  });
  return finalStyles;
}

function wuyiPartitionStyles(styles, presets) {
  var list = wuyiStyleList(styles);
  var presetMap = {};
  (presets || []).forEach(function (name) { presetMap[name] = true; });
  var picked = [];
  var custom = [];
  list.forEach(function (name) {
    if (presetMap[name]) picked.push(name);
    else custom.push(name);
  });
  return { picked: picked, custom: custom };
}

// Same default rules as wuyi-order getDefaultStatus: 7 days notice (8 after 18:00),
// about one month ahead, optional Monday closure, and the hardcoded holiday list.
function wuyiOrderBaselineOpen(dStr, blockMonday, now) {
  var d = wuyiParseYMD(dStr);
  d.setHours(0, 0, 0, 0);
  var today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  today.setHours(0, 0, 0, 0);
  if (d < today) return false;
  var oneMonthAhead = new Date(today.getFullYear(), today.getMonth() + 1, today.getDate());
  if (d > oneMonthAhead) return false;
  var diffDays = Math.round((d.getTime() - today.getTime()) / (1000 * 3600 * 24));
  var preorder = now.getHours() >= 18 ? 8 : 7;
  if (diffDays < preorder) return false;
  if (blockMonday && d.getDay() === 1) return false;
  if (WUYI_ORDER_DEFAULT_CLOSED.indexOf(dStr) !== -1) return false;
  return true;
}

function wuyiMondayBaselineOpen(dStr, blockMonday) {
  var d = wuyiParseYMD(dStr);
  if (blockMonday && d.getDay() === 1) return false;
  return true;
}

function wuyiEffectiveOpen(data, dStr, baselineOpen) {
  var map = data && data.calendarDateStatus;
  if (map && Object.prototype.hasOwnProperty.call(map, dStr)) {
    var explicit = wuyiNormalizeOpen(map[dStr]);
    if (explicit !== null) return explicit;
  }
  var closed = data && Array.isArray(data.closedDates) ? data.closedDates : [];
  if (closed.indexOf(dStr) !== -1) return false;
  var special = data && Array.isArray(data.specialOpenDates) ? data.specialOpenDates : [];
  if (special.indexOf(dStr) !== -1) return true;
  return !!baselineOpen(dStr);
}

function wuyiExplicitMap(data) {
  var map = {};
  var raw = data && data.calendarDateStatus ? data.calendarDateStatus : {};
  Object.keys(raw).forEach(function (key) {
    var explicit = wuyiNormalizeOpen(raw[key]);
    if (explicit !== null) map[key] = explicit ? "open" : "closed";
  });
  var closed = data && Array.isArray(data.closedDates) ? data.closedDates : [];
  closed.forEach(function (day) {
    if (!map[day]) map[day] = "closed";
  });
  var special = data && Array.isArray(data.specialOpenDates) ? data.specialOpenDates : [];
  special.forEach(function (day) {
    if (!map[day]) map[day] = "open";
  });
  return map;
}

function wuyiAbsorbCalendar(stateObj, data, fromOffset, toOffset, baselineOpen, now) {
  var horizon = {};
  var day;
  for (day = fromOffset; day <= toOffset; day++) {
    var date = new Date(now.getFullYear(), now.getMonth(), now.getDate() + day);
    var dStr = wuyiFormatYMD(date);
    horizon[dStr] = true;
    stateObj[dStr] = wuyiEffectiveOpen(data, dStr, baselineOpen);
  }
  var extras = {};
  var explicit = wuyiExplicitMap(data);
  Object.keys(explicit).forEach(function (key) {
    if (!horizon[key]) extras[key] = explicit[key];
  });
  return extras;
}

function wuyiEnsureDay(stateObj, extras, dStr, baselineOpen) {
  if (stateObj[dStr] !== undefined) return;
  if (extras && (extras[dStr] === "open" || extras[dStr] === "closed")) {
    stateObj[dStr] = extras[dStr] === "open";
    delete extras[dStr];
    return;
  }
  stateObj[dStr] = !!baselineOpen(dStr);
}

function wuyiSparseStatus(stateObj, baselineOpen, extras) {
  var map = {};
  if (extras) {
    Object.keys(extras).forEach(function (key) {
      if (extras[key] === "open" || extras[key] === "closed") map[key] = extras[key];
    });
  }
  Object.keys(stateObj).forEach(function (dStr) {
    var open = !!stateObj[dStr];
    if (open !== !!baselineOpen(dStr)) map[dStr] = open ? "open" : "closed";
    else delete map[dStr];
  });
  return map;
}

function wuyiBuildOrderPayload(stateObj, blockMonday, extras, now) {
  return {
    updatedAt: now.toISOString(),
    disableMonday: !!blockMonday,
    calendarDateStatus: wuyiSparseStatus(stateObj, function (dStr) {
      return wuyiOrderBaselineOpen(dStr, blockMonday, now);
    }, extras)
  };
}

function wuyiBuildWeekPayload(stateObj, blockMonday, extras, now) {
  return {
    category: WUYI_GAS_WEEK_CATEGORY,
    updatedAt: now.toISOString(),
    disableMonday: !!blockMonday,
    calendarDateStatus: wuyiSparseStatus(stateObj, function (dStr) {
      return wuyiMondayBaselineOpen(dStr, blockMonday);
    }, extras)
  };
}

function wuyiBuildFlowerPayload(stateObj, blockMonday, extras, now) {
  return {
    category: WUYI_GAS_FLOWER_CATEGORY,
    type: WUYI_GAS_FLOWER_CATEGORY,
    updatedAt: now.toISOString(),
    disableMonday: !!blockMonday,
    calendarDateStatus: wuyiSparseStatus(stateObj, function (dStr) {
      return wuyiMondayBaselineOpen(dStr, blockMonday);
    }, extras)
  };
}

function wuyiBuildGlobalCalendarPayload(category, originalMap, disableMonday, gridState, withType, now) {
  var map = {};
  Object.keys(originalMap || {}).forEach(function (key) {
    map[key] = originalMap[key];
  });
  Object.keys(gridState || {}).forEach(function (dStr) {
    map[dStr] = gridState[dStr] ? "open" : "closed";
  });
  var payload = {
    updatedAt: now.toISOString(),
    disableMonday: !!disableMonday,
    calendarDateStatus: map
  };
  if (category) payload.category = category;
  if (withType && category) payload.type = category;
  return payload;
}

function wuyiBuildBurgerPayload(styles, lockToday, now) {
  return {
    category: WUYI_GAS_BURGER_CATEGORY,
    updatedAt: now.toISOString(),
    styles: styles.slice(),
    validDate: lockToday ? wuyiFormatYMD(now) : ""
  };
}

function wuyiStable(value) {
  if (Array.isArray(value)) return "[" + value.map(wuyiStable).join(",") + "]";
  if (value && typeof value === "object") {
    return "{" + Object.keys(value).sort().map(function (key) {
      return JSON.stringify(key) + ":" + wuyiStable(value[key]);
    }).join(",") + "}";
  }
  return JSON.stringify(value);
}

function wuyiPayloadStored(saved, payload) {
  if (!saved || typeof saved !== "object") return false;
  if (payload.updatedAt && saved.updatedAt === payload.updatedAt) return true;
  if (Object.prototype.hasOwnProperty.call(payload, "styles")) {
    if (wuyiStable(wuyiStyleList(saved.styles)) !== wuyiStable(wuyiStyleList(payload.styles))) return false;
    return wuyiNormalizeDateStr(saved.validDate) === wuyiNormalizeDateStr(payload.validDate);
  }
  if (typeof saved.disableMonday === "boolean" && saved.disableMonday !== !!payload.disableMonday) return false;
  var savedMap = saved.calendarDateStatus && typeof saved.calendarDateStatus === "object" ? saved.calendarDateStatus : {};
  var wantMap = payload.calendarDateStatus || {};
  return wuyiStable(savedMap) === wuyiStable(wantMap);
}

function wuyiUnwrapGas(json, category) {
  if (!(json && (json.status === "success" || json.data || (category && json[category])))) {
    throw new Error("試算表回傳格式異常");
  }
  var data = json.data || json;
  if (category && data && data[category] && typeof data[category] === "object") data = data[category];
  return data || {};
}

function wuyiGasGet(category) {
  var url = WUYI_GAS_CALENDAR_API + "?t=" + Date.now();
  if (category) url += "&category=" + encodeURIComponent(category);
  return fetch(url, { method: "GET", cache: "no-store" }).then(function (res) {
    if (!res.ok) throw new Error("試算表讀取失敗 HTTP " + res.status);
    return res.json();
  }).then(function (json) {
    return wuyiUnwrapGas(json, category);
  });
}

function wuyiGasPost(payload) {
  var postError = null;
  var postTask = fetch(WUYI_GAS_CALENDAR_API, {
    method: "POST",
    redirect: "follow",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload)
  }).catch(function (err) {
    postError = err;
  });
  return postTask.then(function () {
    var category = payload.category || null;
    var lastError = postError;
    var attempt = 0;
    function check() {
      return wuyiGasGet(category).then(function (saved) {
        if (wuyiPayloadStored(saved, payload)) return saved;
        lastError = new Error("試算表沒有存進這次的設定，請再按一次。");
        return retry();
      }).catch(function (err) {
        lastError = postError || err;
        return retry();
      });
    }
    function retry() {
      attempt += 1;
      if (attempt >= 3) throw lastError || new Error("試算表沒有存進這次的設定，請再按一次。");
      return new Promise(function (resolve) { setTimeout(resolve, 400); }).then(check);
    }
    return check();
  });
}
