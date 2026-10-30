import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const context = {
  console,
  setTimeout,
  Date,
  Math,
  JSON,
  Object,
  Array,
  String,
  Number,
  Error,
  Promise,
  parseInt,
  encodeURIComponent,
  fetch: null
};
vm.createContext(context);
vm.runInContext(fs.readFileSync(new URL("./calendar-gas.js", import.meta.url), "utf8"), context, { filename: "calendar-gas.js" });

const {
  wuyiFormatYMD,
  wuyiParseYMD,
  wuyiOrderBaselineOpen,
  wuyiAbsorbCalendar,
  wuyiSparseStatus,
  wuyiBuildOrderPayload,
  wuyiBuildWeekPayload,
  wuyiBuildFlowerPayload,
  wuyiBuildGlobalCalendarPayload,
  wuyiBuildBurgerPayload,
  wuyiPayloadStored,
  wuyiGasPost,
  wuyiExplicitMap,
  WUYI_GAS_WEEK_CATEGORY
} = context;

const morning = new Date(2026, 9, 30, 10, 0, 0);
assert.equal(wuyiFormatYMD(morning), "2026-10-30");

function addDays(now, days) {
  return wuyiFormatYMD(new Date(now.getFullYear(), now.getMonth(), now.getDate() + days));
}

assert.equal(wuyiOrderBaselineOpen(addDays(morning, 1), true, morning), false);
assert.equal(wuyiOrderBaselineOpen(addDays(morning, 6), true, morning), false);
assert.equal(wuyiOrderBaselineOpen("2026-11-24", true, morning), false);
const day7 = addDays(morning, 7);
assert.equal(wuyiOrderBaselineOpen(day7, true, morning), wuyiParseYMD(day7).getDay() !== 1);

const evening = new Date(2026, 9, 30, 19, 0, 0);
assert.equal(wuyiOrderBaselineOpen(addDays(evening, 7), true, evening), false);

const cloud = {
  disableMonday: true,
  calendarDateStatus: {
    "2026-11-01": "open",
    "2026-11-02": "closed",
    "2026-11-24": "closed",
    "2027-03-01": "open"
  },
  closedDates: ["2026-12-02"]
};
const state = {};
const extras = wuyiAbsorbCalendar(state, cloud, 1, 63, (dStr) => wuyiOrderBaselineOpen(dStr, true, morning), morning);
assert.equal(state["2026-11-01"], true);
assert.equal(state["2026-11-02"], false);
assert.equal(extras["2027-03-01"], "open");
assert.equal(state["2027-03-01"], undefined);

const payload = wuyiBuildOrderPayload(state, true, extras, morning);
assert.equal(payload.category, undefined);
assert.equal(payload.disableMonday, true);
assert.equal(payload.calendarDateStatus["2026-11-01"], "open");
assert.equal(payload.calendarDateStatus["2026-11-02"], undefined);
assert.equal(payload.calendarDateStatus["2026-11-24"], undefined);
assert.equal(payload.calendarDateStatus["2027-03-01"], "open");
assert.equal(Object.prototype.hasOwnProperty.call(payload, "category"), false);

const week = wuyiBuildWeekPayload({ "2026-11-03": false, "2026-11-04": true }, true, {}, morning);
assert.equal(week.category, "cakethisweek_calander");
assert.equal(week.category, WUYI_GAS_WEEK_CATEGORY);
assert.equal(week.type, undefined);
assert.equal(week.calendarDateStatus["2026-11-03"], "closed");
assert.equal(week.calendarDateStatus["2026-11-04"], undefined);

const flower = wuyiBuildFlowerPayload({ "2026-11-02": true }, true, { "2027-04-01": "closed" }, morning);
assert.equal(flower.category, "flower");
assert.equal(flower.type, "flower");
assert.equal(flower.calendarDateStatus["2026-11-02"], "open");
assert.equal(flower.calendarDateStatus["2027-04-01"], "closed");

const globalOrder = wuyiBuildGlobalCalendarPayload(null, wuyiExplicitMap(cloud), true, { "2026-11-01": false, "2026-11-05": true }, false, morning);
assert.equal(globalOrder.category, undefined);
assert.equal(globalOrder.calendarDateStatus["2026-11-01"], "closed");
assert.equal(globalOrder.calendarDateStatus["2026-11-05"], "open");
assert.equal(globalOrder.calendarDateStatus["2027-03-01"], "open");
assert.equal(globalOrder.calendarDateStatus["2026-12-02"], "closed");

const burger = wuyiBuildBurgerPayload(["D 款", "自訂"], false, morning);
assert.deepEqual(burger.styles, ["D 款", "自訂"]);
assert.equal(burger.validDate, "");
assert.equal(burger.category, "Burger");
assert.equal(wuyiPayloadStored({ updatedAt: burger.updatedAt, styles: ["D 款", "自訂"], validDate: "" }, burger), true);
assert.equal(wuyiPayloadStored({ styles: "D 款,自訂", validDate: "" }, burger), true);

const calls = [];
context.fetch = async (url, options = {}) => {
  calls.push({ url, options });
  if (options.method === "POST") {
    const err = new Error("CORS redirect");
    throw err;
  }
  const body = JSON.parse(calls.find((call) => call.options.method === "POST").options.body);
  return {
    ok: true,
    json: async () => ({ status: "success", category: "default", data: body })
  };
};
const saved = await wuyiGasPost(payload);
assert.equal(saved.updatedAt, payload.updatedAt);
assert.equal(calls[0].options.method, "POST");
assert.equal(calls[0].options.headers["Content-Type"], "text/plain;charset=utf-8");
assert.equal(calls[0].url.includes("category="), false);
assert.equal(calls[1].options.method, "GET");

for (const file of ["index.html", "admin.html"]) {
  const html = fs.readFileSync(new URL("./" + file, import.meta.url), "utf8");
  assert.equal(html.includes("ghp_"), false, file + " still has a token");
  assert.equal(html.includes("api.github.com"), false, file + " still calls GitHub");
  assert.equal(html.includes("githubPutFile"), false, file);
  assert.equal(html.includes("calendar-gas.js"), true, file);
  assert.equal(html.includes("DEFAULT_TOKEN"), false, file);
  assert.equal(html.includes("Authorization"), false, file);
}

const gas = fs.readFileSync(new URL("./calendar-gas.js", import.meta.url), "utf8");
assert.equal(gas.includes("ghp_"), false);
assert.equal(gas.includes("api.github.com"), false);

console.log("calendar-gas tests passed");
