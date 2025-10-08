# DHIS2 App Development Guide

## Project Overview
This is a DHIS2 web app template for creating administrative tools. It's a vanilla JavaScript app using webpack that integrates with the DHIS2 API for tracker date validation management.

## Architecture & Key Components

### DHIS2 Integration Layer (`src/js/d2api.js`)
- **Core API wrapper**: Exports `d2Get`, `d2PostJson`, `d2PutJson`, `d2Patch`, `d2Delete`, and `d2PostThenGet`
- **Authentication**: Handles both development mode (Basic auth from `d2auth.json`) and production mode (session-based)
- **Endpoint normalization**: Automatically formats endpoints to `/api/...` format and validates UIDs (11-char alphanumeric)
- **Error handling**: Standardized error responses with DHIS2 API error details

### Development vs Production Mode
- **Dev mode**: Triggered by presence of `d2auth.json` file, uses Basic auth headers
- **Production**: Relies on DHIS2 session cookies, uses relative URLs (`../../..`)
- **Config template**: Copy `d2auth.template.json` to `d2auth.json` for local development

### DHIS2 Header Bar Integration (`src/js/check-header-bar.js`)
- **Version detection**: Checks DHIS2 version via `/api/system/info.json`
- **Legacy support**: Loads `resources/dhis-header-bar.js` for DHIS2 < 42.x
- **Modern versions**: Hides header bar div for DHIS2 ≥ 42.x (uses built-in header)

## Development Workflow

### Essential Commands
```bash
yarn install              # Install dependencies
yarn start                # Dev server on :8081 with hot reload
yarn build                # Production build to /build
yarn zip                  # Create installable .zip in /compiled
yarn lint                 # ESLint validation
```

### Development Setup
1. Copy `d2auth.template.json` → `d2auth.json` and update credentials
2. Default assumes DHIS2 on `localhost:8080/dhis` with `admin:district`
3. Dev server proxies to DHIS2 instance and handles CORS/authentication

### Build Process
- **Webpack entry**: `src/app.js` (imports CSS, JS modules)
- **Manifest generation**: `d2-manifest` creates `manifest.webapp` from `package.json`
- **Asset copying**: Icons, resources, and static files copied to build
- **Hash-based naming**: JS bundles get content hashes for cache busting

## Code Patterns & Conventions

### ES6 Module Structure
- Use ES6 imports/exports (not CommonJS)
- Main entry: `src/app.js` imports all dependencies
- API calls: Import from `./js/d2api.js`
- Example: `import { d2Get } from "./js/d2api.js";`

### DHIS2 API Patterns
- **Always use the d2api wrapper**: Never call fetch() directly for DHIS2 endpoints
- **UID validation**: PUT/DELETE operations warn if endpoint doesn't end with 11-char UID
- **Async/await**: All API calls return promises, use async/await consistently
- **Error propagation**: API errors include DHIS2 response details, catch and handle appropriately

### ESLint Configuration
- 4-space indentation, double quotes, semicolons required
- Browser globals enabled, Node.js globals (require, process) available
- `DHIS_CONFIG` global injected by webpack for environment detection
- Console statements allowed (admin tool context)

### File Organization
- **Static assets**: Place in `src/img/`, `src/css/`, auto-copied to build
- **DHIS2 resources**: Legacy scripts in `src/resources/`
- **Entry point**: Always `src/app.js`, webpack handles dependencies
- **HTML template**: `src/index.html` with required `#dhis-header-bar` div

## Key Integration Points

### Webpack Configuration Special Features
- **JSESSIONID handling**: Dev server fetches session cookie from DHIS2 for proper authentication
- **DHIS_CONFIG global**: Webpack injects auth config as global variable
- **Asset loaders**: Handles CSS, images, fonts with appropriate loaders
- **Development proxy**: Hot reload with proper DHIS2 integration

### DHIS2 App Manifest
- Generated from `package.json` manifest.webapp section
- Icons must be 48x48 and 96x96 PNG in `src/img/icons/`
- App type "APP" for administrative tools (not dashboard widgets)

## Testing & Debugging
- Use browser dev tools with source maps enabled
- API calls logged to console with detailed error information
- Dev server provides hot reload for rapid iteration
- Test authentication with different DHIS2 instances via `d2auth.json`

## 
Web app is built with webpack, with webpack-dev-server for development. yarn is used for dependencies. Focus on the actual code, mention when dependencies must be added.

These are the files and structure of a DHIS2 web app:
- app.js - logic of the app. Any function accessed from index.html must be exported to the window object like, like this: window.helloWorld = async function () {}

index.html - specify the actual content to put in body, not header etc.

style.css - for css styling

./js/d2api.js - should be used for ALL DHIS2 api communication, with 5 async functions exported to app.js:
d2Get(endpoint), d2Delete(endpoint), d2PostJson(endpoint, body), d2PutJson(endpoint, body) and d2Patch(endpoint, body). Endpoint is DHIS2 api endpoints like `/api/dataElements`. d2PutJson, d2Patch and d2Delete assume the endpoint includes the UID of the object. The functions throws an error if the GET/POST/PUT/PATCH fails. Don't change d2api.js code unless strictly necessary. When updating a dhis2 metadata object, first fetch the full object with all properties using fields=:owner

Ask if DHIS2 object props are unknown.

Make sure styling match, falling back to Material design. Make it simple and user friendly. Always give feedback on success/failure when making changes to DHIS2 (post, put, delete).

Suggest existing libraries when useful to keep code simple, ideally modern ones. Use modern javascript capabilities (ES6 etc). Never use react. Code style: use double quotes.

In index.html, only change code inside the mainView div.
For styling, use materialize-css (including for tabs, buttons, text, headers and applied to any datatables components.)
Use these libraries if needed:
* For tables, use datatables
* For dropdowns (except inside datatables), use choices.js

Some DHIS2 Web API basics:
* To get all owned/key fields, use fields=:owner
* if field is not specified, the default is id,displayName
* filter syntax is filter=property:operator:value (e.g. filter=program.id:eq:abc123)
* multiple filters are ANDed unless rootJunction=OR is specified
* paging is on by default, use paging=false to get all results

Examples of objects:
/api/programs/N07iEegH3Hw?fields=name,id,programStages[name,id,executionDateLabel,hideDueDate,programStageDataElements[dataElement[id,name,valueType]],programStageSections[id,name,dataElements[id]]],trackedEntityType[trackedEntityTypeAttributes[id,name,valueType]],programTrackedEntityAttributes[trackedEntityAttribute[id,name,valueType]],enrollmentDateLabel,incidentDateLabel,displayIncidentDate,ignoreOverdueEvents
returns an object like this:
{
"name": "Case Surveillance",
"enrollmentDateLabel": "Date of notification",
"displayIncidentDate": false,
"ignoreOverdueEvents": false,
"trackedEntityType": {
"trackedEntityTypeAttributes": [
{
"name": "Person GEN - Given name",
"valueType": "TEXT",
"id": "MfXSc2xb4vY"
},
{
"name": "Person GEN - Family name",
"valueType": "TEXT",
"id": "HYeadAriaLf"
}
]
},
"id": "N07iEegH3Hw",
"programStages": [
{
"name": "Notification and Initial Case Report",
"programStageDataElements": [],
"executionDateLabel": "Date of data entry",
"hideDueDate": true,
"id": "wVrLHHbixoP",
"programStageSections": []
},
{
"name": "Case Investigation - Cholera",
"programStageDataElements": [
{
"dataElement": {
"name": "CS - Travel history: outside country past 5 days",
"valueType": "TEXT",
"id": "CupZIB04EQz"
}
},
{
"dataElement": {
"name": "CS - Travel history: location",
"valueType": "TEXT",
"id": "wJhUAPwfF8i"
}
},
{
"dataElement": {
"name": "CS - Travel history: country visited",
"valueType": "TEXT",
"id": "N3IS3OagIdq"
}
},
{
"dataElement": {
"name": "CS - Travel history: date of arrival",
"valueType": "DATE",
"id": "aVMZfLbFEDd"
}
},
{
"dataElement": {
"name": "CS - Travel history: date of departure",
"valueType": "DATE",
"id": "wnmqzX8qiAE"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: contact with similar illness or symptoms",
"valueType": "TEXT",
"id": "rQtUsTPVVAa"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Relation",
"valueType": "TEXT",
"id": "Nv360KUiArY"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Types of interaction",
"valueType": "MULTI_TEXT",
"id": "WmPRP8UnQPj"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Date of last interaction",
"valueType": "DATE",
"id": "j6xNqobJroP"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Location/place of interaction",
"valueType": "TEXT",
"id": "qOdn85xflsI"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: has contact with travel history",
"valueType": "TEXT",
"id": "oz8liPYVaat"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Travel history location of contact",
"valueType": "TEXT",
"id": "qPCXlTsCOIQ"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Relation to contact with travel history",
"valueType": "TEXT",
"id": "kmYWjK2aqOV"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Start date of travel of contact",
"valueType": "DATE",
"id": "N5WSrJwcpAF"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: End date of travel of contact",
"valueType": "DATE",
"id": "XCEGqDpoFJv"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Date of last interaction with contact that travelled",
"valueType": "DATE",
"id": "bD7djA1ghz4"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: attended social event or mass gathering",
"valueType": "TEXT",
"id": "vjtTtleyFJ8"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: type of social event or mass gathering",
"valueType": "TEXT",
"id": "C9zWHgKN5Pc"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: location of social event or mass gathering",
"valueType": "TEXT",
"id": "zKMM8YYVzhI"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: date of social event or mass gathering",
"valueType": "DATE",
"id": "aygD9WuxCNw"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: household member attended social event or mass gathering",
"valueType": "TEXT",
"id": "OfRzBtv9nXH"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: type of social event or mass gathering attended by contact",
"valueType": "TEXT",
"id": "N2jGXcs7uzn"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: location of social event or mass gathering attended by contact",
"valueType": "TEXT",
"id": "iZVgflqY4hy"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: date of social event or mass gathering attended by contact",
"valueType": "DATE",
"id": "E3dFqNFee03"
}
},
{
"dataElement": {
"name": "CS - Main occupation/work",
"valueType": "TEXT",
"id": "pBHj2dNyx9p"
}
},
{
"dataElement": {
"name": "CS-CHOL - Places of occupation/work in 5 days before onset",
"valueType": "TEXT",
"id": "Sewbd5WZJ0A"
}
},
{
"dataElement": {
"name": "CS-CHOL - Drinking water: other drinking water sources (outside household)",
"valueType": "MULTI_TEXT",
"id": "XQmCFQGLlCb"
}
},
{
"dataElement": {
"name": "CS-CHOL - Drinking water: household stored water in 5 days before onset",
"valueType": "TEXT",
"id": "HjIwIp5FqM1"
}
},
{
"dataElement": {
"name": "CS-CHOL - Place of defecation shared outside household",
"valueType": "TEXT",
"id": "intMrxoZBvw"
}
},
{
"dataElement": {
"name": "CS-CHOL - Other observations related to water, sanitation, and hygiene",
"valueType": "LONG_TEXT",
"id": "MiU2Sa73tgR"
}
},
{
"dataElement": {
"name": "CS-CHOL - Food consumption: vendors of food from outside house",
"valueType": "TEXT",
"id": "FeTGckBqrrF"
}
},
{
"dataElement": {
"name": "CS-CHOL - Hand washing routines",
"valueType": "MULTI_TEXT",
"id": "o06fmniAGzC"
}
},
{
"dataElement": {
"name": "CS-CHOL - Food consumption: food eaten from outside house in 5 days before onset",
"valueType": "MULTI_TEXT",
"id": "zjoNCUgGl6h"
}
},
{
"dataElement": {
"name": "CS-CHOL - Place of defecation of household",
"valueType": "MULTI_TEXT",
"id": "jrsjL9mEMTt"
}
},
{
"dataElement": {
"name": "CS-CHOL - Drinking water: actions to make water safe in 5 days before onset",
"valueType": "TEXT",
"id": "tGe8LtuErLR"
}
},
{
"dataElement": {
"name": "CS-CHOL - Drinking water: actions to make water safe  - specified",
"valueType": "MULTI_TEXT",
"id": "pLB3f68DYaV"
}
},
{
"dataElement": {
"name": "CS-CHOL - Drinking water: household main source of water in 5 days before onset",
"valueType": "MULTI_TEXT",
"id": "YDK8Cvz6qVU"
}
},
{
"dataElement": {
"name": "CS-CHOL - Drinking water: other containers types for storage",
"valueType": "TEXT",
"id": "fKdZIi7SW6t"
}
},
{
"dataElement": {
"name": "CS-CHOL - Drinking water: household stored water in narrow mouthed containers/Jerrycans",
"valueType": "TRUE_ONLY",
"id": "aN2HXq8J0Lb"
}
},
{
"dataElement": {
"name": "CS-CHOL - Geographic origin of infection",
"valueType": "TEXT",
"id": "jxPeicDkQ7G"
}
},
{
"dataElement": {
"name": "CS - Epidemiological link",
"valueType": "TEXT",
"id": "FJDCGSAA3BV"
}
},
{
"dataElement": {
"name": "CS-CHOL - Epidemiological link of cholera case",
"valueType": "TEXT",
"id": "bsqinkZVeEu"
}
},
{
"dataElement": {
"name": "CS-CHOL - Hypotheses on exposure(s) and contexts of transmission",
"valueType": "LONG_TEXT",
"id": "dxhbKvj0P23"
}
},
{
"dataElement": {
"name": "CS - Travel history: country visited (2)",
"valueType": "TEXT",
"id": "PladWBXg3Ho"
}
},
{
"dataElement": {
"name": "CS - Travel history: country visited (3)",
"valueType": "TEXT",
"id": "OuUteJSdZO1"
}
},
{
"dataElement": {
"name": "CS - Travel history: date of arrival (2)",
"valueType": "DATE",
"id": "Lgb30TtoEaU"
}
},
{
"dataElement": {
"name": "CS - Travel history: date of arrival (3)",
"valueType": "DATE",
"id": "DbVAg2LjFcF"
}
},
{
"dataElement": {
"name": "CS - Travel history: date of departure (2)",
"valueType": "DATE",
"id": "yXibLkZpByu"
}
},
{
"dataElement": {
"name": "CS - Travel history: date of departure (3)",
"valueType": "DATE",
"id": "WUNmVaQpVF9"
}
},
{
"dataElement": {
"name": "CS - Travel history: location (2)",
"valueType": "TEXT",
"id": "nNsv3QvtvkH"
}
},
{
"dataElement": {
"name": "CS - Travel history: location (3)",
"valueType": "TEXT",
"id": "ntwH3JRtios"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Date of last interaction (2)",
"valueType": "DATE",
"id": "jq6M8hW8jvw"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Date of last interaction (3)",
"valueType": "DATE",
"id": "cT3gNe2t2sh"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Date of last interaction with contact that travelled (2)",
"valueType": "DATE",
"id": "UFJ19yF0Evu"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Date of last interaction with contact that travelled (3)",
"valueType": "DATE",
"id": "YDdUHLbu6e7"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: date of social event or mass gathering (2)",
"valueType": "DATE",
"id": "Dzze7A9iefy"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: date of social event or mass gathering (3)",
"valueType": "DATE",
"id": "COkZcpYF17H"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: date of social event or mass gathering attended by contact (2)",
"valueType": "DATE",
"id": "NQWr3g0AUgV"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: date of social event or mass gathering attended by contact (3)",
"valueType": "DATE",
"id": "ZdFtx8ThiHV"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: End date of travel of contact (2)",
"valueType": "DATE",
"id": "sdZz7gZphFG"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: End date of travel of contact (3)",
"valueType": "DATE",
"id": "VlBBNV43hBk"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: location of social event or mass gathering (2)",
"valueType": "TEXT",
"id": "Z8R5cVr0RoL"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: location of social event or mass gathering (3)",
"valueType": "TEXT",
"id": "DDQYGXwu8QF"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: location of social event or mass gathering attended by contact (2)",
"valueType": "TEXT",
"id": "A87RJXkPxl9"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: location of social event or mass gathering attended by contact (3)",
"valueType": "TEXT",
"id": "vJJLMfSidDl"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Location/place of interaction (2)",
"valueType": "TEXT",
"id": "WnGdTJ7Lkz5"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Location/place of interaction (3)",
"valueType": "TEXT",
"id": "msoRIdjliNz"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Relation (2)",
"valueType": "TEXT",
"id": "jWMl4Rn1duy"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Relation (3)",
"valueType": "TEXT",
"id": "dBhkRVXji02"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Relation to contact with travel history (2)",
"valueType": "TEXT",
"id": "flvbaQFYai5"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Relation to contact with travel history (3)",
"valueType": "TEXT",
"id": "TCEYFzyij8s"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Start date of travel of contact (2)",
"valueType": "DATE",
"id": "Ch1wejIGo9P"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Start date of travel of contact (3)",
"valueType": "DATE",
"id": "I3gaxrvPboG"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Travel history location of contact (2)",
"valueType": "TEXT",
"id": "NzlUk8Pp0hi"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Travel history location of contact (3)",
"valueType": "TEXT",
"id": "OAKCq2JrvkX"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: type of social event or mass gathering (2)",
"valueType": "TEXT",
"id": "TNhanisluZC"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: type of social event or mass gathering (3)",
"valueType": "TEXT",
"id": "HUHaRqFjnSo"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: type of social event or mass gathering attended by contact (2)",
"valueType": "TEXT",
"id": "fN6ATEWkQbL"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: type of social event or mass gathering attended by contact (3)",
"valueType": "TEXT",
"id": "JpHzg3s7MdQ"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Types of interaction (2)",
"valueType": "MULTI_TEXT",
"id": "Eq4LFXcbfnL"
}
},
{
"dataElement": {
"name": "CS-CHOL - Social interaction: Types of interaction (3)",
"valueType": "MULTI_TEXT",
"id": "AuDV4WZsu8D"
}
}
],
"executionDateLabel": "Date of investigation",
"hideDueDate": true,
"id": "Bp4vK4Zms2j",
"programStageSections": [
{
"name": "Travel history",
"dataElements": [
{
"id": "CupZIB04EQz"
},
{
"id": "wJhUAPwfF8i"
},
{
"id": "N3IS3OagIdq"
},
{
"id": "aVMZfLbFEDd"
},
{
"id": "wnmqzX8qiAE"
},
{
"id": "nNsv3QvtvkH"
},
{
"id": "PladWBXg3Ho"
},
{
"id": "Lgb30TtoEaU"
},
{
"id": "yXibLkZpByu"
},
{
"id": "ntwH3JRtios"
},
{
"id": "OuUteJSdZO1"
},
{
"id": "DbVAg2LjFcF"
},
{
"id": "WUNmVaQpVF9"
}
],
"id": "CVBPrwDrRKe"
},
{
"name": "Social interactions and gatherings - contact with person with similar illness/symptoms",
"dataElements": [
{
"id": "rQtUsTPVVAa"
},
{
"id": "Nv360KUiArY"
},
{
"id": "WmPRP8UnQPj"
},
{
"id": "j6xNqobJroP"
},
{
"id": "qOdn85xflsI"
},
{
"id": "jWMl4Rn1duy"
},
{
"id": "Eq4LFXcbfnL"
},
{
"id": "jq6M8hW8jvw"
},
{
"id": "WnGdTJ7Lkz5"
},
{
"id": "dBhkRVXji02"
},
{
"id": "AuDV4WZsu8D"
},
{
"id": "cT3gNe2t2sh"
},
{
"id": "msoRIdjliNz"
}
],
"id": "tNcId38gwUP"
},
{
"name": "Social interactions and gatherings - contact with person with travel history",
"dataElements": [
{
"id": "oz8liPYVaat"
},
{
"id": "kmYWjK2aqOV"
},
{
"id": "qPCXlTsCOIQ"
},
{
"id": "N5WSrJwcpAF"
},
{
"id": "XCEGqDpoFJv"
},
{
"id": "bD7djA1ghz4"
},
{
"id": "flvbaQFYai5"
},
{
"id": "NzlUk8Pp0hi"
},
{
"id": "Ch1wejIGo9P"
},
{
"id": "sdZz7gZphFG"
},
{
"id": "UFJ19yF0Evu"
},
{
"id": "TCEYFzyij8s"
},
{
"id": "OAKCq2JrvkX"
},
{
"id": "VlBBNV43hBk"
},
{
"id": "I3gaxrvPboG"
},
{
"id": "YDdUHLbu6e7"
}
],
"id": "KSGUUKvalcF"
},
{
"name": "Social interactions and gatherings - attending event or mass gathering",
"dataElements": [
{
"id": "vjtTtleyFJ8"
},
{
"id": "C9zWHgKN5Pc"
},
{
"id": "aygD9WuxCNw"
},
{
"id": "zKMM8YYVzhI"
},
{
"id": "TNhanisluZC"
},
{
"id": "Dzze7A9iefy"
},
{
"id": "Z8R5cVr0RoL"
},
{
"id": "HUHaRqFjnSo"
},
{
"id": "COkZcpYF17H"
},
{
"id": "DDQYGXwu8QF"
}
],
"id": "o4vWMhL1F8h"
},
{
"name": "Social interactions and gatherings - contact attended event or mass gathering",
"dataElements": [
{
"id": "OfRzBtv9nXH"
},
{
"id": "N2jGXcs7uzn"
},
{
"id": "E3dFqNFee03"
},
{
"id": "iZVgflqY4hy"
},
{
"id": "fN6ATEWkQbL"
},
{
"id": "NQWr3g0AUgV"
},
{
"id": "A87RJXkPxl9"
},
{
"id": "JpHzg3s7MdQ"
},
{
"id": "ZdFtx8ThiHV"
},
{
"id": "vJJLMfSidDl"
}
],
"id": "UZxiXUkwi9V"
},
{
"name": "Occupation/work",
"dataElements": [
{
"id": "pBHj2dNyx9p"
},
{
"id": "Sewbd5WZJ0A"
}
],
"id": "tB98rBL1v0i"
},
{
"name": "Water, sanitation and hygiene",
"dataElements": [
{
"id": "YDK8Cvz6qVU"
},
{
"id": "XQmCFQGLlCb"
},
{
"id": "tGe8LtuErLR"
},
{
"id": "pLB3f68DYaV"
},
{
"id": "HjIwIp5FqM1"
},
{
"id": "aN2HXq8J0Lb"
},
{
"id": "fKdZIi7SW6t"
},
{
"id": "jrsjL9mEMTt"
},
{
"id": "intMrxoZBvw"
},
{
"id": "o06fmniAGzC"
},
{
"id": "MiU2Sa73tgR"
}
],
"id": "ZEtAgsigmk7"
},
{
"name": "Food consumption",
"dataElements": [
{
"id": "zjoNCUgGl6h"
},
{
"id": "FeTGckBqrrF"
}
],
"id": "Lw09cBLLuVN"
},
{
"name": "Case investigation conclusions",
"dataElements": [
{
"id": "jxPeicDkQ7G"
},
{
"id": "FJDCGSAA3BV"
},
{
"id": "bsqinkZVeEu"
},
{
"id": "dxhbKvj0P23"
}
],
"id": "n80PifZF34G"
}
]
},
{
"name": "Case investigation - Ebola",
"programStageDataElements": [
{
"dataElement": {
"name": "CS - Contact with case: contact with suspected/confirmed case in last 3 weeks before onset",
"valueType": "TEXT",
"id": "KPzSr3il3EK"
}
},
{
"dataElement": {
"name": "CS - Contact with case: last name of case",
"valueType": "TEXT",
"id": "PX31CFoSwG7"
}
},
{
"dataElement": {
"name": "CS - Contact with case: first name of case",
"valueType": "TEXT",
"id": "svjleHOlFyi"
}
},
{
"dataElement": {
"name": "CS - Contact with case: contition of case",
"valueType": "TEXT",
"id": "tpz5GLJRLlK"
}
},
{
"dataElement": {
"name": "CS - Contact with case: date of death of case",
"valueType": "DATE",
"id": "FxGwDMIqDfE"
}
},
{
"dataElement": {
"name": "CS - Contact with case: date of last contact with case",
"valueType": "DATE",
"id": "fl5ecH4PGKg"
}
},
{
"dataElement": {
"name": "CS - Hospital visit: hospitalized or visited hospital in last 3 weeks before onset",
"valueType": "TEXT",
"id": "b2j1yxTQ2t6"
}
},
{
"dataElement": {
"name": "CS - Hospital visit: name of hospital",
"valueType": "TEXT",
"id": "ae6T9qsxY4x"
}
},
{
"dataElement": {
"name": "CS - Hospital visit: date of visit to hospital",
"valueType": "DATE",
"id": "GGeT1GZlMgd"
}
},
{
"dataElement": {
"name": "CS - Traditional healer: seen traditional healer in last 3 weeks before onset",
"valueType": "TEXT",
"id": "x6HpawCcWMS"
}
},
{
"dataElement": {
"name": "CS - Traditional healer: last name of healer",
"valueType": "TEXT",
"id": "Ofxyf3M2uXu"
}
},
{
"dataElement": {
"name": "CS - Traditional healer: first name of healer",
"valueType": "TEXT",
"id": "a0M2aEIbr6Z"
}
},
{
"dataElement": {
"name": "CS - Traditional healer: village of healer",
"valueType": "TEXT",
"id": "xSxl06yQINF"
}
},
{
"dataElement": {
"name": "CS - Traditional healer: date of consultation with healer",
"valueType": "DATE",
"id": "mjBaMrqWZcd"
}
},
{
"dataElement": {
"name": "CS - Traditional healer: received traditional treatment",
"valueType": "TEXT",
"id": "myHotRAcPSS"
}
},
{
"dataElement": {
"name": "CS - Traditional healer: type of traditional treatment",
"valueType": "TEXT",
"id": "D2dPOjoB19Z"
}
},
{
"dataElement": {
"name": "CS - Funeral attended in last 3 weeks before onset",
"valueType": "TEXT",
"id": "J17OaoR7D86"
}
},
{
"dataElement": {
"name": "CS - Funeral attendance: last name of deceased",
"valueType": "TEXT",
"id": "UDYG2woyc4M"
}
},
{
"dataElement": {
"name": "CS - Funeral attendance: first name of deceased",
"valueType": "TEXT",
"id": "sTFV0X895QK"
}
},
{
"dataElement": {
"name": "CS - Animal contact: contact with wild animals in last 3 weeks before onset",
"valueType": "TEXT",
"id": "vzpIFnLncEz"
}
},
{
"dataElement": {
"name": "CS - Animal contact: kind of animal in contact",
"valueType": "TEXT",
"id": "P9EpSKBGd1F"
}
},
{
"dataElement": {
"name": "CS - Animal contact: place/location of animal contact",
"valueType": "TEXT",
"id": "fbgKe62ZvLF"
}
},
{
"dataElement": {
"name": "CS - Animal contact: date of animal contact",
"valueType": "DATE",
"id": "DkuZH7OMHm9"
}
},
{
"dataElement": {
"name": "CS - Mine/cave work: worked in mine/cave with bats in last 3 weeks before onset",
"valueType": "TEXT",
"id": "kQO4xTmmuyp"
}
},
{
"dataElement": {
"name": "CS - Mine/cave work: name of mine",
"valueType": "TEXT",
"id": "prIZTBoiA0e"
}
},
{
"dataElement": {
"name": "CS - Mine/cave work: place/location of mine",
"valueType": "TEXT",
"id": "oHyGlDMACk7"
}
},
{
"dataElement": {
"name": "CS - Mine/cave work: date of mine activity",
"valueType": "DATE",
"id": "klY94br38P6"
}
},
{
"dataElement": {
"name": "CS - Travel history: travelled in last 3 weeks before onset",
"valueType": "TEXT",
"id": "CAwcHrW7kyQ"
}
},
{
"dataElement": {
"name": "CS - Travel history: country visited",
"valueType": "TEXT",
"id": "N3IS3OagIdq"
}
},
{
"dataElement": {
"name": "CS - Travel history: location",
"valueType": "TEXT",
"id": "wJhUAPwfF8i"
}
},
{
"dataElement": {
"name": "CS - Travel history: date of departure",
"valueType": "DATE",
"id": "wnmqzX8qiAE"
}
},
{
"dataElement": {
"name": "CS - Travel history: date of arrival",
"valueType": "DATE",
"id": "aVMZfLbFEDd"
}
}
],
"hideDueDate": true,
"id": "QySccNXHQnL",
"programStageSections": [
{
"name": "Contact with suspected or confirmed case",
"dataElements": [
{
"id": "KPzSr3il3EK"
},
{
"id": "svjleHOlFyi"
},
{
"id": "PX31CFoSwG7"
},
{
"id": "tpz5GLJRLlK"
},
{
"id": "FxGwDMIqDfE"
},
{
"id": "fl5ecH4PGKg"
}
],
"id": "ljc4H31Zsdl"
},
{
"name": "Hospitalization or hospital visits",
"dataElements": [
{
"id": "b2j1yxTQ2t6"
},
{
"id": "ae6T9qsxY4x"
},
{
"id": "GGeT1GZlMgd"
}
],
"id": "plwRIxDh8ab"
},
{
"name": "Traditional healer and treatment",
"dataElements": [
{
"id": "x6HpawCcWMS"
},
{
"id": "a0M2aEIbr6Z"
},
{
"id": "Ofxyf3M2uXu"
},
{
"id": "xSxl06yQINF"
},
{
"id": "mjBaMrqWZcd"
},
{
"id": "myHotRAcPSS"
},
{
"id": "D2dPOjoB19Z"
}
],
"id": "bEJJQRxB8H1"
},
{
"name": "Contact with wild animals",
"dataElements": [
{
"id": "vzpIFnLncEz"
},
{
"id": "P9EpSKBGd1F"
},
{
"id": "fbgKe62ZvLF"
},
{
"id": "DkuZH7OMHm9"
}
],
"id": "pMhqsDX1enV"
},
{
"name": "Mine or cave inhabited by bats",
"dataElements": [
{
"id": "kQO4xTmmuyp"
},
{
"id": "prIZTBoiA0e"
},
{
"id": "oHyGlDMACk7"
},
{
"id": "klY94br38P6"
}
],
"id": "WRNdQ7fl6jT"
},
{
"name": "Travel history",
"dataElements": [
{
"id": "CAwcHrW7kyQ"
},
{
"id": "N3IS3OagIdq"
},
{
"id": "wJhUAPwfF8i"
},
{
"id": "wnmqzX8qiAE"
},
{
"id": "aVMZfLbFEDd"
}
],
"id": "v0gKvVrdcUl"
}
]
},
{
"name": "Case Investigation - Mpox",
"programStageDataElements": [
{
"dataElement": {
"name": "CS - Travel history: outside country past 5 days",
"valueType": "TEXT",
"id": "CupZIB04EQz"
}
},
{
"dataElement": {
"name": "CS-MPOX - What is the most likely mode of transmission?",
"valueType": "TEXT",
"id": "ieXT5ZTILGL"
}
},
{
"dataElement": {
"name": "CS-MPOX - Contact with animal?",
"valueType": "TEXT",
"id": "JbKGlFEq8zR"
}
},
{
"dataElement": {
"name": "CS - Cluster number or ID",
"valueType": "TEXT",
"id": "RW6Rt9glqKN"
}
},
{
"dataElement": {
"name": "CS - Travel history: country visited",
"valueType": "TEXT",
"id": "N3IS3OagIdq"
}
},
{
"dataElement": {
"name": "CS - Case ID",
"valueType": "TEXT",
"id": "STsTo1FRBhv"
}
},
{
"dataElement": {
"name": "CS-MPOX - Living in IDP or refugee camp",
"valueType": "TEXT",
"id": "ju9YiXuvTsw"
}
},
{
"dataElement": {
"name": "CS - Travel history: location",
"valueType": "TEXT",
"id": "wJhUAPwfF8i"
}
},
{
"dataElement": {
"name": "Gender",
"valueType": "TEXT",
"id": "JIEh6TzXj2S"
}
},
{
"dataElement": {
"name": "CS-MPOX - Sexual behavior",
"valueType": "TEXT",
"id": "KU9ZrlkxuXY"
}
},
{
"dataElement": {
"name": "CS-MPOX - Healthcare worker",
"valueType": "TEXT",
"id": "tA7fb6vZMdJ"
}
},
{
"dataElement": {
"name": "CS-MPOX - Sex worker",
"valueType": "TEXT",
"id": "kKVsgFRL4b3"
}
},
{
"dataElement": {
"name": "CS-MPOX - Exposure",
"valueType": "TEXT",
"id": "mc4z35lBMOO"
}
},
{
"dataElement": {
"name": "CS-MPOX - Immunosuppressed status",
"valueType": "TEXT",
"id": "vmldYZyJEgf"
}
},
{
"dataElement": {
"name": "CS-MPOX - HIV status",
"valueType": "TEXT",
"id": "RDsCVIFI8bZ"
}
},
{
"dataElement": {
"name": "CS-MPOX - HIV treatment",
"valueType": "TEXT",
"id": "RoYwCGfXJvX"
}
},
{
"dataElement": {
"name": "CS-MPOX - Case receive mpox vaccination",
"valueType": "TEXT",
"id": "xojsXDeJ0pF"
}
},
{
"dataElement": {
"name": "CS-MPOX - Case receive first dose of mpox vaccines related this event",
"valueType": "TEXT",
"id": "MaW4zRMzxgp"
}
},
{
"dataElement": {
"name": "CS-MPOX - Date of first dose smallpox/mpox vaccination",
"valueType": "DATE",
"id": "TQvSrIvAsXN"
}
},
{
"dataElement": {
"name": "CS-MPOX - Vaccine brand first smallpox/mpox vaccine",
"valueType": "TEXT",
"id": "YvrRcrth21R"
}
},
{
"dataElement": {
"name": "CS-MPOX - Case receive second dose of mpox vaccines related this event",
"valueType": "TEXT",
"id": "uq2iIifBdj2"
}
},
{
"dataElement": {
"name": "CS-MPOX - Date of second dose smallpox/mpox vaccination",
"valueType": "DATE",
"id": "VuNNM1HkyEe"
}
},
{
"dataElement": {
"name": "CS-MPOX - Vaccine brand second smallpox/mpox vaccine",
"valueType": "TEXT",
"id": "zP920PRJqMi"
}
},
{
"dataElement": {
"name": "CS-MPOX - Exposure type",
"valueType": "MULTI_TEXT",
"id": "ZxFKKXpk2Hn"
}
},
{
"dataElement": {
"name": "CS-MPOX - Animal contact",
"valueType": "MULTI_TEXT",
"id": "Oeu33WtVQr8"
}
}
],
"executionDateLabel": "Date of investigation",
"hideDueDate": true,
"id": "icxxjPKZNXT",
"programStageSections": [
{
"name": "Mpox - Case Information",
"dataElements": [
{
"id": "STsTo1FRBhv"
},
{
"id": "RW6Rt9glqKN"
},
{
"id": "JIEh6TzXj2S"
},
{
"id": "ju9YiXuvTsw"
},
{
"id": "KU9ZrlkxuXY"
},
{
"id": "tA7fb6vZMdJ"
},
{
"id": "kKVsgFRL4b3"
}
],
"id": "UsKJWjtPZ0M"
},
{
"name": "Mpox - Immunosuppression and HIV status",
"dataElements": [
{
"id": "vmldYZyJEgf"
},
{
"id": "RDsCVIFI8bZ"
},
{
"id": "RoYwCGfXJvX"
}
],
"id": "K2lWQuLfZBU"
},
{
"name": "Mpox - Vaccination",
"dataElements": [
{
"id": "xojsXDeJ0pF"
},
{
"id": "MaW4zRMzxgp"
},
{
"id": "TQvSrIvAsXN"
},
{
"id": "YvrRcrth21R"
},
{
"id": "uq2iIifBdj2"
},
{
"id": "VuNNM1HkyEe"
},
{
"id": "zP920PRJqMi"
}
],
"id": "pnVZc2nN4GJ"
},
{
"name": "Mpox - Exposure",
"dataElements": [
{
"id": "mc4z35lBMOO"
},
{
"id": "ZxFKKXpk2Hn"
}
],
"id": "I8frXiMX3sq"
},
{
"name": "Mpox - Animal contact",
"dataElements": [
{
"id": "JbKGlFEq8zR"
},
{
"id": "Oeu33WtVQr8"
}
],
"id": "iqTfCT1tCYy"
},
{
"name": "Mpox - Animal contact type",
"dataElements": [],
"id": "WbyHadlXKYE"
},
{
"name": "Mpox - Likely mode of transmission",
"dataElements": [
{
"id": "ieXT5ZTILGL"
}
],
"id": "myCqjvdwxJu"
},
{
"name": "Mpox - Travel History",
"dataElements": [
{
"id": "CupZIB04EQz"
},
{
"id": "N3IS3OagIdq"
},
{
"id": "wJhUAPwfF8i"
}
],
"id": "vZtUvCFbQHb"
}
]
},
{
"name": "Lab request",
"programStageDataElements": [
{
"dataElement": {
"name": "CS - Date specimen collected",
"valueType": "DATE",
"id": "Ho9XGkcOHmv"
}
},
{
"dataElement": {
"name": "CS - Date specimen sent to lab",
"valueType": "DATE",
"id": "b6jXmgpX4cF"
}
},
{
"dataElement": {
"name": "CS - Specimen collected",
"valueType": "TEXT",
"id": "DlKhvaUo6Y1"
}
},
{
"dataElement": {
"name": "CS-CHOL - Culture or PCR testing",
"valueType": "TEXT",
"id": "q08zjVSEWdK"
}
},
{
"dataElement": {
"name": "CS-MPOX - Specimen type",
"valueType": "TEXT",
"id": "uOTHQEUGua0"
}
},
{
"dataElement": {
"name": "CS - Specimen ID",
"valueType": "TEXT",
"id": "TS6Yt0weEhi"
}
}
],
"executionDateLabel": "Date of data entry",
"hideDueDate": true,
"id": "d62zsvlENzr",
"programStageSections": [
{
"name": "ID",
"dataElements": [
{
"id": "TS6Yt0weEhi"
}
],
"id": "bt1jcerWuoG"
},
{
"name": "Date information",
"dataElements": [
{
"id": "Ho9XGkcOHmv"
},
{
"id": "b6jXmgpX4cF"
}
],
"id": "x1eKS9qa3i2"
},
{
"name": "Mpox request",
"dataElements": [
{
"id": "uOTHQEUGua0"
}
],
"id": "xdeREE4p8RX"
},
{
"name": "Cholera request",
"dataElements": [
{
"id": "DlKhvaUo6Y1"
},
{
"id": "q08zjVSEWdK"
}
],
"id": "YagADjLo7Zg"
}
]
},
{
"name": "Lab result",
"programStageDataElements": [
{
"dataElement": {
"name": "CS-CHOL - RDT result cholera",
"valueType": "TEXT",
"id": "a6TlTAXVvbM"
}
},
{
"dataElement": {
"name": "CS - Date specimen received at lab",
"valueType": "DATE",
"id": "PCXCMNuEpA3"
}
},
{
"dataElement": {
"name": "CS-CHOL - Culture result",
"valueType": "TEXT",
"id": "zcsTfJ1Gfoj"
}
},
{
"dataElement": {
"name": "CS-CHOL - PCR result - serogroup",
"valueType": "TEXT",
"id": "rHgXxhth4wT"
}
},
{
"dataElement": {
"name": "CS-CHOL - PCR result - toxigenicity",
"valueType": "TEXT",
"id": "GMXzfv27rNa"
}
},
{
"dataElement": {
"name": "CS-MPOX - Lab method",
"valueType": "TEXT",
"id": "MT0kvzW7dQV"
}
},
{
"dataElement": {
"name": "CS-MPOX - Genomic characterization undertaken?",
"valueType": "TEXT",
"id": "d2yqj4a4kqs"
}
},
{
"dataElement": {
"name": "CS-MPOX - Clade of monkeypox virus",
"valueType": "TEXT",
"id": "V3nKReCYlNs"
}
},
{
"dataElement": {
"name": "CS - Specimen ID",
"valueType": "TEXT",
"id": "TS6Yt0weEhi"
}
},
{
"dataElement": {
"name": "CS-CHOL - Antimicrobial susceptibility testing",
"valueType": "TEXT",
"id": "AcBu1hqMKDR"
}
},
{
"dataElement": {
"name": "CS-CHOL - AST drug tested",
"valueType": "MULTI_TEXT",
"id": "eofpCP0nmiS"
}
},
{
"dataElement": {
"name": "CS - Lab: antigen detected",
"valueType": "TEXT",
"id": "FZ7ncbjoaMW"
}
},
{
"dataElement": {
"name": "CS - Lab: IgG serology result",
"valueType": "TEXT",
"id": "smdUSAhYfk8"
}
},
{
"dataElement": {
"name": "CS - Lab: IgM serology result",
"valueType": "TEXT",
"id": "e3eFGUly9Gq"
}
},
{
"dataElement": {
"name": "CS - Lab: immunofluorescence result",
"valueType": "TEXT",
"id": "CxL36VjBs9I"
}
},
{
"dataElement": {
"name": "CS - Lab: imunohistochemical staining result",
"valueType": "TEXT",
"id": "hdhOikNFnhr"
}
},
{
"dataElement": {
"name": "CS - Lab: RT-PCR result",
"valueType": "TEXT",
"id": "akgtbp3yBUz"
}
},
{
"dataElement": {
"name": "CS - Lab: virus culture result",
"valueType": "TEXT",
"id": "x7I3wYVxq6i"
}
}
],
"executionDateLabel": "Date of laboratory result",
"hideDueDate": true,
"id": "mDvE6kdNpty",
"programStageSections": [
{
"name": "ID",
"dataElements": [
{
"id": "TS6Yt0weEhi"
}
],
"id": "Rh2rUc80ZwU"
},
{
"name": "Date",
"dataElements": [
{
"id": "PCXCMNuEpA3"
}
],
"id": "oXZm5lWrhXy"
},
{
"name": "Cholera - Lab result",
"dataElements": [
{
"id": "a6TlTAXVvbM"
},
{
"id": "zcsTfJ1Gfoj"
},
{
"id": "rHgXxhth4wT"
},
{
"id": "GMXzfv27rNa"
},
{
"id": "AcBu1hqMKDR"
},
{
"id": "eofpCP0nmiS"
}
],
"id": "FQgxkxzjxiB"
},
{
"name": "Ebola - Lab result",
"dataElements": [
{
"id": "FZ7ncbjoaMW"
},
{
"id": "e3eFGUly9Gq"
},
{
"id": "smdUSAhYfk8"
},
{
"id": "akgtbp3yBUz"
},
{
"id": "x7I3wYVxq6i"
},
{
"id": "hdhOikNFnhr"
},
{
"id": "CxL36VjBs9I"
}
],
"id": "LbNVJYZaj55"
},
{
"name": "Mpox - Lab result",
"dataElements": [
{
"id": "MT0kvzW7dQV"
},
{
"id": "d2yqj4a4kqs"
},
{
"id": "V3nKReCYlNs"
}
],
"id": "BX1wNPjs35U"
}
]
},
{
"name": "Case classification and outcome",
"programStageDataElements": [
{
"dataElement": {
"name": "CS - Outcome",
"valueType": "TEXT",
"id": "qYvi7aTKxBb"
}
},
{
"dataElement": {
"name": "CS - Date of discharge/transfer/death",
"valueType": "DATE",
"id": "hnYf8COfKJC"
}
},
{
"dataElement": {
"name": "CS - Date of recovery/death",
"valueType": "DATE",
"id": "ESFP9poj3rJ"
}
},
{
"dataElement": {
"name": "CS - Final Case Classification",
"valueType": "TEXT",
"id": "l0VWouzntiy"
}
}
],
"executionDateLabel": "Date of classification",
"hideDueDate": true,
"id": "F3mxJxwJi2e",
"programStageSections": [
{
"name": "Outcome",
"dataElements": [
{
"id": "qYvi7aTKxBb"
},
{
"id": "hnYf8COfKJC"
},
{
"id": "ESFP9poj3rJ"
},
{
"id": "l0VWouzntiy"
}
],
"id": "FpFNoJoQQ8P"
}
]
}
],
"programTrackedEntityAttributes": [
{
"trackedEntityAttribute": {
"name": "CS - Initial Diagnosis",
"valueType": "TEXT",
"id": "tvaF9No9nkF"
}
},
{
"trackedEntityAttribute": {
"name": "GEN - National ID",
"valueType": "TEXT",
"id": "Ewi7FUfcHAD"
}
},
{
"trackedEntityAttribute": {
"name": "CS - Record ID",
"valueType": "TEXT",
"id": "gO00x3YrZMH"
}
},
{
"trackedEntityAttribute": {
"name": "GEN - Given name",
"valueType": "TEXT",
"id": "sB1IHYu2xQT"
}
},
{
"trackedEntityAttribute": {
"name": "GEN - Family name",
"valueType": "TEXT",
"id": "nJsmdQXRoze"
}
},
{
"trackedEntityAttribute": {
"name": "GEN - Date of birth",
"valueType": "DATE",
"id": "NI0QRzJvQ0k"
}
},
{
"trackedEntityAttribute": {
"name": "GEN - Date of birth is estimated",
"valueType": "TRUE_ONLY",
"id": "Z1rLc1rVHK8"
}
},
{
"trackedEntityAttribute": {
"name": "GEN - Age (years)",
"valueType": "INTEGER_ZERO_OR_POSITIVE",
"id": "bSssQxhP8Ic"
}
},
{
"trackedEntityAttribute": {
"name": "GEN - Age (months)",
"valueType": "INTEGER_POSITIVE",
"id": "fncDrNotzeS"
}
},
{
"trackedEntityAttribute": {
"name": "GEN - Sex",
"valueType": "TEXT",
"id": "oindugucx72"
}
},
{
"trackedEntityAttribute": {
"name": "GEN - Contact phone number (local)",
"valueType": "PHONE_NUMBER",
"id": "fctSQp5nAYl"
}
},
{
"trackedEntityAttribute": {
"name": "GEN - Address (current)",
"valueType": "LONG_TEXT",
"id": "A6Hb0Kvg4vb"
}
}
]
}

/api/programRules?fields=:owner&paging=false
{"programRules": [
{
"name": "CS - Case report: Hide symptoms unless relevant for disease",
"created": "2025-10-06T13:52:41.162",
"lastUpdated": "2025-10-06T14:01:55.540",
"translations": [],
"lastUpdatedBy": {
"id": "LPPQqlgctSx",
"code": null,
"name": "Olav Poppe",
"displayName": "Olav Poppe",
"username": "olavpo"
},
"description": "Hide the section for symptoms unless it is relevant for the given disease",
"program": {
"id": "N07iEegH3Hw"
},
"programStage": {
"id": "wVrLHHbixoP"
},
"programRuleActions": [
{
"id": "QfFvhrZfvne"
}
],
"condition": "!d2:validatePattern(A{INITIAL_DIAGNOSIS}, '.*\\\\b(EBOLA|MPOX)\\\\b.*')",
"priority": 1,
"id": "C1jm9IIVz0p"
}
]
}

api/programRuleActions?fields=:owner&paging=false
{"programRuleActions": [
{
"created": "2025-09-25T10:45:03.428",
"lastUpdated": "2025-09-26T11:12:14.942",
"translations": [],
"lastUpdatedBy": {
"id": "LPPQqlgctSx",
"code": null,
"name": "Olav Poppe",
"displayName": "Olav Poppe",
"username": "olavpo"
},
"programRule": {
"id": "HKgumRcR3Kv"
},
"programRuleActionType": "HIDEFIELD",
"dataElement": {
"id": "OuUteJSdZO1"
},
"id": "A1xjtkI6zvE"
}
]
}

/api/programRuleVariables?fields=:owner
{
"programRuleVariables": [
{
"name": "AGE_ESTIMATED",
"created": "2025-07-29T19:31:20.406",
"lastUpdated": "2025-09-24T14:14:32.366",
"translations": [],
"lastUpdatedBy": {
"id": "LPPQqlgctSx",
"code": null,
"name": "Olav Poppe",
"displayName": "Olav Poppe",
"username": "olavpo"
},
"program": {
"id": "N07iEegH3Hw"
},
"useCodeForOptionSet": true,
"id": "cXJkCgxBU5h",
"programRuleVariableSourceType": "TEI_ATTRIBUTE",
"trackedEntityAttribute": {
"id": "Z1rLc1rVHK8"
},
"valueType": "TRUE_ONLY"
}
]
}