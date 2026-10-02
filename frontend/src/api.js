// Small wrappers around fetch for the JSON API.

async function parse(response) {
    const body = await response.json().catch(() => null);
    if (!response.ok) {
        // DRF validation errors look like {field: [messages]}.
        const detail = body && typeof body === 'object'
            ? Object.entries(body).map(([field, messages]) => `${field}: ${[].concat(messages).join(' ')}`).join(' ')
            : '';
        throw new Error(detail || `HTTP error! status: ${response.status}`);
    }
    return body;
}

export function getJson(url) {
    return fetch(url).then(parse);
}

export function sendJson(method, url, data) {
    return fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
    }).then(parse);
}
