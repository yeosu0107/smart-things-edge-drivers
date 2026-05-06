local cosock = require "cosock"
local https = cosock.asyncify "ssl.https"
local ltn12 = require "ltn12"
local json = require "dkjson"
local socket_url = require "socket.url"
local log = require "log"
local Driver = require "st.driver"
local capabilities = require "st.capabilities"

local bus_message_cap = capabilities["yeosu0107.busMessage"]

local function clean_bus_msg(raw_msg)
    if not raw_msg or raw_msg == "" then
        return nil
    end

    if string.find(raw_msg, "운행종료") then
        return nil
    end

    local cleaned = string.gsub(raw_msg, "%[.-%]", "")
    cleaned = string.gsub(cleaned, "^%s*(.-)%s*$", "%1")
    return cleaned
end

local function arrival_suffix(msg)
    if string.find(msg, "곧 도착") or string.find(msg, "출발대기") then
        return "입니다"
    end
    return " 도착 예정입니다"
end

local function build_message(items)
    local parts = {}
    for _, item in ipairs(items) do
        local bus_name = item.rtNm
        local msg1 = clean_bus_msg(item.arrmsg1)
        local msg2 = clean_bus_msg(item.arrmsg2)

        if msg1 then
            local part
            if msg2 then
                part = string.format("%s번 버스는 먼저 %s, 다음 버스는 %s%s",
                    bus_name, msg1, msg2, arrival_suffix(msg2))
            else
                part = string.format("%s번 버스는 %s%s",
                    bus_name, msg1, arrival_suffix(msg1))
            end
            table.insert(parts, part)
        end
    end

    if #parts > 0 then
        return "현재 정류장의 버스 도착 정보입니다. " .. table.concat(parts, ". ")
    end
    return "현재 운행 중이거나 도착 예정인 버스가 없습니다."
end

local function emit_message(device, text)
    device:emit_event(bus_message_cap.value(text))
end

local function fetch_seoul_bus_info(device)
    local api_key = device.preferences.apiKey
    local ars_id = device.preferences.stationId

    if not api_key or api_key == "" or not ars_id or ars_id == "" then
        log.warn("API Key 또는 ARS-ID 미설정")
        emit_message(device, "API Key 또는 정류소 ID를 설정해주세요.")
        return
    end

    local url = "https://ws.bus.go.kr/api/rest/stationinfo/getStationByUid"
        .. "?ServiceKey=" .. socket_url.escape(api_key)
        .. "&arsId=" .. socket_url.escape(ars_id)
        .. "&resultType=json"

    local response_body = {}
    local res, code = https.request {
        url = url,
        method = "GET",
        sink = ltn12.sink.table(response_body),
    }

    if not res then
        log.error("HTTP 요청 실패: " .. tostring(code))
        emit_message(device, "버스 정보 조회에 실패했습니다.")
        return
    end

    if code ~= 200 then
        log.error("API 응답 코드 비정상: " .. tostring(code))
        emit_message(device, "버스 정보 조회에 실패했습니다.")
        return
    end

    local body_string = table.concat(response_body)
    local data, _, err = json.decode(body_string, 1, nil)

    if not data then
        log.error("JSON 파싱 실패: " .. tostring(err))
        emit_message(device, "버스 정보 응답을 처리할 수 없습니다.")
        return
    end

    if not data.msgBody or not data.msgBody.itemList then
        log.warn("응답에 itemList 없음")
        emit_message(device, "해당 정류장의 버스 정보가 없습니다.")
        return
    end

    local message = build_message(data.msgBody.itemList)
    emit_message(device, message)
    log.info("업데이트 성공: " .. message)
end

local function device_init(driver, device)
    log.info("device_init: " .. tostring(device.id))
end

local function device_added(driver, device)
    log.info("device_added: 초기 조회")
    fetch_seoul_bus_info(device)
end

local function device_info_changed(driver, device, event, args)
    local old = args.old_st_store and args.old_st_store.preferences or {}
    local new = device.preferences
    if old.apiKey ~= new.apiKey or old.stationId ~= new.stationId then
        log.info("preferences 변경 감지, 재조회")
        fetch_seoul_bus_info(device)
    end
end

local function handle_refresh(driver, device, command)
    log.info("refresh 명령 수신")
    fetch_seoul_bus_info(device)
end

local driver_template = {
    supported_capabilities = {
        capabilities.refresh,
        bus_message_cap,
    },
    lifecycle_handlers = {
        init = device_init,
        added = device_added,
        infoChanged = device_info_changed,
    },
    capability_handlers = {
        [capabilities.refresh.ID] = {
            [capabilities.refresh.commands.refresh.NAME] = handle_refresh,
        },
    },
}

local bus_driver = Driver("BusAlarm_Driver", driver_template)
bus_driver:run()
