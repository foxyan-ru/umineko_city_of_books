import http from "k6/http";
import { check } from "k6";
import { Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://127.0.0.1:4323";
const TARGET_ID = __ENV.TARGET_ID || "";
const ROOM_ID = __ENV.ROOM_ID || "";
const USERS = JSON.parse(open("./users.json"));

const reportAccepted = new Counter("report_accepted");
const reportRejected = new Counter("report_rejected");
const chatAccepted = new Counter("chat_accepted");
const chatThrottled = new Counter("chat_throttled");

http.setResponseCallback(http.expectedStatuses(201, 429));

export const options = {
    scenarios: {
        report_flood: {
            executor: "constant-vus",
            vus: 5,
            duration: "20s",
            exec: "report",
        },
        chat_control: {
            executor: "per-vu-iterations",
            vus: 1,
            iterations: 10,
            maxDuration: "20s",
            exec: "chat",
        },
    },
};

function authHeaders(vu) {
    const user = USERS[vu % USERS.length];

    return {
        headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${user.token}`,
        },
    };
}

export function report() {
    const res = http.post(
        `${BASE_URL}/api/v1/report`,
        JSON.stringify({ target_type: "post", target_id: TARGET_ID, reason: "harness flood" }),
        authHeaders(__VU),
    );

    check(res, { "report accepted": (r) => r.status === 201 });
    if (res.status === 201) {
        reportAccepted.add(1);
    } else {
        reportRejected.add(1);
    }
}

export function chat() {
    const res = http.post(
        `${BASE_URL}/api/v1/chat/rooms/${ROOM_ID}/messages`,
        JSON.stringify({ body: `harness control ${Date.now()}` }),
        authHeaders(__VU),
    );

    check(res, { "chat send limited": (r) => r.status === 201 || r.status === 429 });
    if (res.status === 429) {
        chatThrottled.add(1);
    } else {
        chatAccepted.add(1);
    }
}

export function handleSummary(data) {
    const pick = (name) => (data.metrics[name] ? data.metrics[name].values.count : 0);
    const summary = {
        report_accepted: pick("report_accepted"),
        report_rejected: pick("report_rejected"),
        chat_accepted: pick("chat_accepted"),
        chat_throttled: pick("chat_throttled"),
        http_reqs: pick("http_reqs"),
    };

    return {
        stdout: `${JSON.stringify(summary, null, 2)}\n`,
        "summary.json": JSON.stringify(summary, null, 2),
    };
}
