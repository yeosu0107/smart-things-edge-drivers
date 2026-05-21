async function sendDeviceCommand({ accessToken, deviceId, commands, fetch }) {
  const body = {
    commands: commands.map(c => ({
      component: c.component || 'main',
      capability: c.capability,
      command: c.command,
      arguments: c.arguments || [],
    })),
  };
  const resp = await fetch(`https://api.smartthings.com/devices/${deviceId}/commands`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    const err = new Error(`device command failed: ${resp.status} ${await resp.text()}`);
    err.code = 'DEVICE_COMMAND_FAILED';
    throw err;
  }
  return await resp.json();
}

export { sendDeviceCommand };
