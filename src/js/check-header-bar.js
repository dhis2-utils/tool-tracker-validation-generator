import { d2Get } from "./d2api.js";


function parseServerVersion(versionString) {
    const snapshot = versionString.includes("SNAPSHOT");
    const cleanedVersion = versionString.replace("-SNAPSHOT", "");
    const [majorStr, minorStr, patchStr = "0"] = cleanedVersion.split(".");
    
    return {
        major: parseInt(majorStr, 10),
        minor: parseInt(minorStr, 10),
        patch: parseInt(patchStr, 10),
        snapshot
    };
}

async function shouldLoadLegacyHeaderBar() {
    try {
        const response = await d2Get("api/system/info.json?fields=version");
        const versionInfo = parseServerVersion(response.version || "0.0.0");
        return versionInfo.minor < 42;
    } catch (error) {
        console.error("Error fetching server version:", error);
        return true;
    }
}

export async function loadLegacyHeaderBarIfNeeded() {
    const shouldLoad = await shouldLoadLegacyHeaderBar();
    if (shouldLoad) {
        const script = document.createElement("script");
        script.src = "resources/dhis-header-bar.js";
        script.defer = true;
        document.head.appendChild(script);
    } else {
        const headerBar = document.getElementById("dhis-header-bar");
        if (headerBar) headerBar.style.display = "none";
    }
}