function buildSubscriptionPayload({ deviceId, subscriptionName }) {
  return {
    sourceType: 'DEVICE',
    device: {
      deviceId,
      componentId: 'main',
      capability: 'switch',
      attribute: 'switch',
      stateChangeOnly: true,
      subscriptionName,
      value: '*',
    },
  };
}

async function registerSubscription({ accessToken, installedAppId, deviceId, fetch }) {
  const payload = buildSubscriptionPayload({ deviceId, subscriptionName: 'busTrigger' });
  const resp = await fetch(`https://api.smartthings.com/installedapps/${installedAppId}/subscriptions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });
  if (!resp.ok) {
    const err = new Error(`subscription register failed: ${resp.status} ${await resp.text()}`);
    err.code = 'SUBSCRIPTION_REGISTER_FAILED';
    throw err;
  }
  return await resp.json();
}

export { buildSubscriptionPayload, registerSubscription };
