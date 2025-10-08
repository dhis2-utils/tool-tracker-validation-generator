"use strict";

//JS
import { d2Get } from "./js/d2api.js";
import { loadLegacyHeaderBarIfNeeded } from "./js/check-header-bar.js";
loadLegacyHeaderBarIfNeeded();

//CSS
import "./css/style.css";

//Test setup by calling API
async function testApi() {
    var sysInfo = await d2Get("/api/system/info.json");
    console.log(sysInfo.version);
}


window.helloWorld = async function () {
    await testApi();
    alert("Hello world...");

};
