// import React from 'react';
// import { createRoot } from 'react-dom/client';

// // The starter shell. Replace this with the console.
// //
// // The console contract (UI-INVENTORY.md) is what the shipped UI tests read, and it is
// // fixed: elements are present or ABSENT, never disabled, and every permission-gated
// // element is resolved by the SERVER. There is no role-to-permission table under web/.
// //
// // The attributes the tests read:
// //   <div    data-testid="app-shell"  data-org-id="org_acme" data-org-theme="cobalt">
// //   <button data-testid="org-option" data-org-id="org_globex">
// //   <tr     data-testid="device-row" data-device-id="dev_lab_mac_01">
// //   <tr     data-testid="user-row"   data-user-id="usr_sam">
// //   <button data-permission="device:control" data-state="unlocked">
// //
// // Everything else — layout, visual language, per-org identity — is yours.

// function Placeholder() {
//   return (
//     <main style={{ fontFamily: 'ui-sans-serif, system-ui, sans-serif', padding: 32, lineHeight: 1.5 }}>
//       <h1 style={{ margin: '0 0 4px' }}>RemoteOps</h1>
//       <p style={{ color: '#5b6270', margin: 0 }}>
//         Starter shell. The API and the console are yours to write — see <code>README.md</code>.
//       </p>
//       <p style={{ color: '#5b6270', margin: '16px 0 0', fontSize: 14 }}>
//         First: <code>server/auth.js</code>, then <code>server/context.js</code> and{' '}
//         <code>server/permissions.js</code>.
//       </p>
//     </main>
//   );
// }

// createRoot(document.getElementById('root')).render(<Placeholder />);



import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';

// --- API helper --------------------------------------------------------

async function apiFetch(path, { method = 'GET', token, body } = {}) {
  const headers = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(`/v1${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
  if (!res.ok) {
    const err = new Error(json?.error?.message || 'request failed');
    err.code = json?.error?.code;
    err.reason = json?.error?.reason;
    err.status = res.status;
    throw err;
  }
  return json;
}

// --- theme ---------------------------------------------------------------

const THEME_COLORS = { cobalt: '#2b5fd9', amber: '#c9822a', slate: '#5b6270', forest: '#2f8f5b', plum: '#8a4fbf' };
const accentFor = (theme) => THEME_COLORS[theme] ?? '#5b6270';

// --- styles (plain inline objects, no external CSS needed) ---------------

const styles = {
  loginPage: { display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh', fontFamily: 'ui-sans-serif, system-ui, sans-serif', background: '#f4f5f7' },
  loginForm: { display: 'flex', flexDirection: 'column', gap: 12, width: 320, padding: 32, background: '#fff', borderRadius: 12, boxShadow: '0 1px 4px rgba(0,0,0,0.08)' },
  loginError: { background: '#fdecea', color: '#8a1f11', padding: '10px 12px', borderRadius: 8, fontSize: 14 },
  shell: { display: 'flex', minHeight: '100vh', fontFamily: 'ui-sans-serif, system-ui, sans-serif', background: '#f7f8fa' },
  sidebar: { width: 240, background: '#fff', borderRight: '1px solid #e5e7eb', display: 'flex', flexDirection: 'column', padding: 16, gap: 16 },
  brand: { fontWeight: 700, fontSize: 18 },
  orgSwitcher: { display: 'flex', flexDirection: 'column', gap: 6 },
  orgButton: { textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer' },
  orgButtonActive: { borderColor: 'var(--accent)', background: 'color-mix(in srgb, var(--accent) 12%, white)', fontWeight: 600 },
  createOrgButton: { textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: '1px dashed #c7cbd1', background: 'transparent', cursor: 'pointer', color: '#5b6270' },
  createOrgForm: { display: 'flex', gap: 6, marginTop: 4 },
  nav: { display: 'flex', flexDirection: 'column', gap: 4, marginTop: 8 },
  navButton: { textAlign: 'left', padding: '8px 10px', borderRadius: 8, border: 'none', background: 'transparent', cursor: 'pointer', color: '#374151' },
  navButtonActive: { background: 'var(--accent)', color: '#fff' },
  footer: { marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 8 },
  roleTag: { fontSize: 12, color: '#5b6270', textTransform: 'uppercase', letterSpacing: 0.5 },
  signOutButton: { padding: '8px 10px', borderRadius: 8, border: '1px solid #e5e7eb', background: '#fff', cursor: 'pointer' },
  main: { flex: 1, padding: 32, borderTop: '4px solid var(--accent)' },
  cardHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 },
  table: { width: '100%', borderCollapse: 'collapse' },
  actionsCell: { display: 'flex', gap: 6, flexWrap: 'wrap' },
};

// --- login page ------------------------------------------------------------

function LoginPage({ onLogin }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const data = await apiFetch('/auth/login', { method: 'POST', body: { email, password } });
      await onLogin(data);
    } catch (err) {
      // Message passed through unchanged from the server -- never improved on,
      // since a more specific message here would be an account-enumeration oracle.
      setError({ message: err.message || 'sign-in failed', code: err.code || 'UNKNOWN' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main style={styles.loginPage}>
      <form onSubmit={handleSubmit} style={styles.loginForm}>
        <h1 style={{ margin: 0 }}>RemoteOps</h1>
        <label>
          Email
          <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required style={{ display: 'block', width: '100%', marginTop: 4 }} />
        </label>
        <label>
          Password
          <input value={password} onChange={(e) => setPassword(e.target.value)} type="password" required style={{ display: 'block', width: '100%', marginTop: 4 }} />
        </label>
        <button type="submit" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
        {error && (
          <div
            data-testid="login-error"
            data-error-code={error.code}
            role="alert"
            aria-live="assertive"
            style={styles.loginError}
          >
            {error.message}
          </div>
        )}
      </form>
    </main>
  );
}

// --- sidebar / nav / org switcher -------------------------------------------

function Sidebar({ me, onSwitchOrg, onCreateOrg, onSignOut, activeCard, onSelectCard }) {
  const [showCreate, setShowCreate] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const p = me.permissions;

  const navItems = [
    { key: 'devices', label: 'Devices', testId: 'nav-devices', visible: p['device:list']?.effect === 'allow' },
    { key: 'people', label: 'People', testId: 'nav-people', visible: p['user:read']?.effect === 'allow' },
    { key: 'grants', label: 'Grants', testId: 'nav-grants', visible: p['user:read']?.effect === 'allow' },
    { key: 'sessions', label: 'Sessions', testId: 'nav-sessions', visible: p['session:view']?.effect === 'allow' },
    { key: 'audit', label: 'Audit', testId: 'nav-audit', visible: p['audit:read']?.effect === 'allow' },
    { key: 'admin', label: 'Admin', testId: 'nav-admin', visible: p['org:update']?.effect === 'allow' || p['org:delete']?.effect === 'allow' },
  ];

  return (
    <aside style={styles.sidebar}>
      <div style={styles.brand}>RemoteOps</div>

      <div style={styles.orgSwitcher}>
        {me.orgs.map((o) => (
          <button
            key={o.id}
            data-testid="org-option"
            data-org-id={o.id}
            onClick={() => onSwitchOrg(o.id)}
            style={{ ...styles.orgButton, ...(o.id === me.orgId ? styles.orgButtonActive : {}) }}
          >
            {o.name}
          </button>
        ))}
        <button data-testid="create-org" onClick={() => setShowCreate((s) => !s)} style={styles.createOrgButton}>
          + New org
        </button>
        {showCreate && (
          <form
            style={styles.createOrgForm}
            onSubmit={async (e) => {
              e.preventDefault();
              if (!newOrgName.trim()) return;
              await onCreateOrg(newOrgName.trim());
              setNewOrgName('');
              setShowCreate(false);
            }}
          >
            <input value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} placeholder="Org name" autoFocus />
            <button type="submit">Create</button>
          </form>
        )}
      </div>

      <nav style={styles.nav}>
        {navItems.filter((n) => n.visible).map((n) => (
          <button
            key={n.key}
            data-testid={n.testId}
            onClick={() => onSelectCard(n.key)}
            style={{ ...styles.navButton, ...(activeCard === n.key ? styles.navButtonActive : {}) }}
          >
            {n.label}
          </button>
        ))}
      </nav>

      <div style={styles.footer}>
        <div style={styles.roleTag}>{me.role}</div>
        <button onClick={onSignOut} style={styles.signOutButton}>Sign out</button>
      </div>
    </aside>
  );
}

// --- Devices card ------------------------------------------------------------

function DevicesCard({ token, orgId, me }) {
  const [devices, setDevices] = useState(null);
  const [error, setError] = useState(null);

  async function refresh() {
    setError(null); 
    try {
      const data = await apiFetch(`/orgs/${orgId}/devices`, { token });
      setDevices(data.devices);
    } catch (err) {
      setError(err);
    }
  }
  useEffect(() => { refresh(); }, [orgId, token]);

  const canAddDevice = me.permissions['device:provision']?.effect === 'allow';

  async function startSession(deviceId, mode) {
    try {
      await apiFetch(`/orgs/${orgId}/sessions`, { method: 'POST', token, body: { deviceId, mode } });
      alert(`${mode} session started`);
    } catch (err) {
      alert(err.message);
    }
  }

  return (
    <div>
      <header style={styles.cardHeader}>
        <h2>Devices</h2>
        {canAddDevice && (
          <button
            data-testid="add-device" data-permission="device:provision" data-state="unlocked"
            onClick={async () => {
              const name = window.prompt('Device name?');
              const kind = window.prompt('Kind (macos/windows/linux/android/ios)?');
              if (name && kind) {
                await apiFetch(`/orgs/${orgId}/devices`, { method: 'POST', token, body: { name, kind } });
                await refresh();
              }
            }}
          >
            + Add device
          </button>
        )}
      </header>

      {error && <p>{error.message}</p>}
      <table style={styles.table}>
        <tbody>
          {devices?.map((d) => (
            <tr key={d.id} data-testid="device-row" data-device-id={d.id}>
              <td>{d.name}</td>
              <td>{d.kind}</td>
              <td>{d.online ? 'online' : 'offline'}</td>
              <td style={styles.actionsCell}>
                {d.permissions['device:view']?.effect === 'allow' && (
                  <button data-testid="start-view" data-permission="device:view" data-state="unlocked" onClick={() => startSession(d.id, 'view')}>View</button>
                )}
                {d.permissions['device:control']?.effect === 'allow' && (
                  <button data-testid="start-control" data-permission="device:control" data-state="unlocked" onClick={() => startSession(d.id, 'control')}>Control</button>
                )}
                {d.permissions['device:terminal']?.effect === 'allow' && (
                  <button data-testid="start-terminal" data-permission="device:terminal" data-state="unlocked" onClick={() => startSession(d.id, 'terminal')}>Terminal</button>
                )}
                {d.permissions['device:file_transfer']?.effect === 'allow' && (
                  <button data-testid="transfer-files" data-permission="device:file_transfer" data-state="unlocked" onClick={() => alert('File transfer UI not built in this pass')}>Transfer files</button>
                )}
                {d.permissions['device:update']?.effect === 'allow' && (
                  <button
                    data-testid="rename-device" data-permission="device:update" data-state="unlocked"
                    onClick={async () => {
                      const name = window.prompt('New name?');
                      if (name) { await apiFetch(`/orgs/${orgId}/devices/${d.id}`, { method: 'PATCH', token, body: { name } }); await refresh(); }
                    }}
                  >
                    Rename
                  </button>
                )}
                {d.permissions['device:provision']?.effect === 'allow' && (
                  <button
                    data-testid="decommission-device" data-permission="device:provision" data-state="unlocked"
                    onClick={async () => {
                      if (window.confirm('Decommission this device?')) {
                        await apiFetch(`/orgs/${orgId}/devices/${d.id}`, { method: 'DELETE', token });
                        await refresh();
                      }
                    }}
                  >
                    Decommission
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- People card ------------------------------------------------------------

function PeopleCard({ token, orgId, me }) {
  const [members, setMembers] = useState(null);

  async function refresh() {
    const data = await apiFetch(`/orgs/${orgId}/members`, { token });
    setMembers(data.members);
  }
  useEffect(() => { refresh(); }, [orgId, token]);

  const canInvite = me.permissions['user:invite']?.effect === 'allow';
  const canRoleUpdate = me.permissions['user:role:update']?.effect === 'allow';
  const canRemove = me.permissions['user:remove']?.effect === 'allow';

  return (
    <div>
      <header style={styles.cardHeader}>
        <h2>People</h2>
        {canInvite && (
          <button
            data-testid="invite-user" data-permission="user:invite" data-state="unlocked"
            onClick={async () => {
              const email = window.prompt('Email to invite?');
              const role = window.prompt('Role? (owner/admin/operator/auditor/viewer)');
              if (email && role) {
                await apiFetch(`/orgs/${orgId}/invites`, { method: 'POST', token, body: { email, role } });
                alert('Invite created');
              }
            }}
          >
            + Invite
          </button>
        )}
      </header>

      <table style={styles.table}>
        <tbody>
          {members?.map((m) => (
            <tr key={m.id} data-testid="user-row" data-user-id={m.id}>
              <td>{m.name}</td>
              <td>{m.email}</td>
              <td>{m.role}</td>
              <td>{m.status}</td>
              <td style={styles.actionsCell}>
                {canRoleUpdate && m.id !== me.user.id && (
                  <select
                    data-testid="role-select" data-permission="user:role:update" data-state="unlocked"
                    defaultValue={m.role}
                    onChange={async (e) => {
                      await apiFetch(`/orgs/${orgId}/members/${m.id}`, { method: 'PATCH', token, body: { role: e.target.value } });
                      await refresh();
                    }}
                  >
                    {['owner', 'admin', 'operator', 'auditor', 'viewer'].map((r) => <option key={r} value={r}>{r}</option>)}
                  </select>
                )}
                {canRemove && (
                  <button
                    data-testid="suspend-user" data-permission="user:remove" data-state="unlocked"
                    onClick={async () => {
                      await apiFetch(`/orgs/${orgId}/members/${m.id}/suspend`, { method: m.status === 'suspended' ? 'DELETE' : 'POST', token });
                      await refresh();
                    }}
                  >
                    {m.status === 'suspended' ? 'Reinstate' : 'Suspend'}
                  </button>
                )}
                {canRemove && (
                  <button
                    data-testid="remove-user" data-permission="user:remove" data-state="unlocked"
                    onClick={async () => {
                      if (window.confirm(`Remove ${m.name}?`)) {
                        await apiFetch(`/orgs/${orgId}/members/${m.id}`, { method: 'DELETE', token });
                        await refresh();
                      }
                    }}
                  >
                    Remove
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Grants card ------------------------------------------------------------

function GrantsCard({ token, orgId, me }) {
  const [grants, setGrants] = useState(null);

  async function refresh() {
    const data = await apiFetch(`/orgs/${orgId}/grants`, { token });
    setGrants(data.grants);
  }
  useEffect(() => { refresh(); }, [orgId, token]);

  const canCreate = me.permissions['grant:create']?.effect === 'allow';
  const canRevoke = me.permissions['grant:revoke']?.effect === 'allow';

  return (
    <div>
      <header style={styles.cardHeader}>
        <h2>Grants</h2>
        {canCreate && (
          <button
            data-testid="new-grant" data-permission="grant:create" data-state="unlocked"
            onClick={async () => {
              const userId = window.prompt('User id to grant to?');
              const permission = window.prompt('Permission (e.g. device:control)?');
              const effect = window.prompt('Effect: allow or deny?', 'allow');
              const deviceId = window.prompt('Device id (optional, blank for org-wide)?') || undefined;
              if (userId && permission && effect) {
                await apiFetch(`/orgs/${orgId}/grants`, { method: 'POST', token, body: { userId, effect, permissions: [permission], deviceId } });
                await refresh();
              }
            }}
          >
            + New grant
          </button>
        )}
      </header>

      <table style={styles.table}>
        <tbody>
          {grants?.map((g) => (
            <tr key={g.id} data-testid="grant-row">
              <td>{g.user_id}</td>
              <td>{g.device_id ?? 'org-wide'}</td>
              <td>{g.effect}</td>
              <td>{Array.isArray(g.permissions) ? g.permissions.join(', ') : g.permissions}</td>
              <td>
                {canRevoke && (
                  <button
                    data-testid="revoke-grant" data-permission="grant:revoke" data-state="unlocked"
                    onClick={async () => { await apiFetch(`/orgs/${orgId}/grants/${g.id}`, { method: 'DELETE', token }); await refresh(); }}
                  >
                    Revoke
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Sessions card ------------------------------------------------------------

function SessionsCard({ token, orgId, me }) {
  const [sessions, setSessions] = useState(null);

  async function refresh() {
    const data = await apiFetch(`/orgs/${orgId}/sessions`, { token });
    setSessions(data.sessions);
  }
  useEffect(() => { refresh(); }, [orgId, token]);

  const canStart = me.permissions['session:start']?.effect === 'allow';
  const canTerminateAny = me.permissions['session:terminate']?.effect === 'allow';

  return (
    <div>
      <header style={styles.cardHeader}>
        <h2>Sessions</h2>
        {canStart && (
          <button
            data-testid="new-session" data-permission="session:start" data-state="unlocked"
            onClick={async () => {
              const deviceId = window.prompt('Device id?');
              const mode = window.prompt('Mode: view/control/terminal', 'view');
              if (deviceId && mode) { await apiFetch(`/orgs/${orgId}/sessions`, { method: 'POST', token, body: { deviceId, mode } }); await refresh(); }
            }}
          >
            + Start session
          </button>
        )}
      </header>

      <table style={styles.table}>
        <tbody>
          {sessions?.map((s) => {
            const isOwn = s.user_id === me.user.id;
            const canStop = (isOwn || canTerminateAny) && s.state === 'active';
            return (
              <tr key={s.id} data-testid="session-row">
                <td>{s.device_id}</td>
                <td>{s.mode}</td>
                <td>{s.state}</td>
                <td>{s.end_reason ?? '—'}</td>
                <td>
                  {canStop && (
                    <button
                      data-testid="stop-session"
                      {...(!isOwn ? { 'data-permission': 'session:terminate' } : {})}
                      data-state="unlocked"
                      onClick={async () => { await apiFetch(`/sessions/${s.id}`, { method: 'DELETE', token }); await refresh(); }}
                    >
                      Stop
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// --- Audit card ------------------------------------------------------------

function AuditCard({ token, orgId }) {
  const [events, setEvents] = useState(null);

  useEffect(() => {
    apiFetch(`/orgs/${orgId}/audit`, { token }).then((data) => setEvents(data.events));
  }, [orgId, token]);

  return (
    <div>
      <h2>Audit</h2>
      <table style={styles.table}>
        <tbody>
          {events?.map((e) => (
            <tr key={e.id} data-testid="audit-row">
              <td>{e.at}</td>
              <td>{e.actor_id}</td>
              <td>{e.action}</td>
              <td>{e.result}</td>
              <td>{e.reason_code ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Admin card ------------------------------------------------------------

function AdminCard({ token, orgId, me, onOrgChanged }) {
  const canUpdate = me.permissions['org:update']?.effect === 'allow';
  const canDelete = me.permissions['org:delete']?.effect === 'allow';

  return (
    <div>
      <h2>Admin</h2>
      <div style={{ display: 'flex', gap: 8 }}>
        {canUpdate && (
          <button
            data-testid="rename-org" data-permission="org:update" data-state="unlocked"
            onClick={async () => {
              const name = window.prompt('New org name?');
              if (name) { await apiFetch(`/orgs/${orgId}`, { method: 'PATCH', token, body: { name } }); await onOrgChanged(); }
            }}
          >
            Rename org
          </button>
        )}
        {canDelete && (
          <button
            data-testid="delete-org" data-permission="org:delete" data-state="unlocked"
            onClick={async () => {
              if (window.confirm('Delete this org? This cannot be undone.')) {
                await apiFetch(`/orgs/${orgId}`, { method: 'DELETE', token });
                await onOrgChanged();
              }
            }}
          >
            Delete org
          </button>
        )}
      </div>
    </div>
  );
}

// --- App shell ------------------------------------------------------------

function App() {
  const [token, setToken] = useState(null);
  const [me, setMe] = useState(null);
  const [activeCard, setActiveCard] = useState('devices');

  async function refreshMe(tok) {
    const data = await apiFetch('/auth/me', { token: tok });
    setMe(data);
  }

  async function handleLogin(loginData) {
    setToken(loginData.token);
    await refreshMe(loginData.token);
  }

  async function handleSwitchOrg(orgId) {
    const data = await apiFetch('/auth/token', { method: 'POST', token, body: { orgId } });
    setToken(data.token);
    await refreshMe(data.token);
  }

  async function handleCreateOrg(name) {
    await apiFetch('/orgs', { method: 'POST', token, body: { name } });
    await refreshMe(token);
  }

  function handleSignOut() {
    setToken(null);
    setMe(null);
  }

  if (!token || !me) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const activeOrg = me.orgs.find((o) => o.id === me.orgId);

  return (
    <div
      data-testid="app-shell"
      data-org-id={me.orgId}
      data-org-theme={activeOrg?.theme}
      style={{ ...styles.shell, '--accent': accentFor(activeOrg?.theme) }}
    >
      <Sidebar
        me={me}
        onSwitchOrg={handleSwitchOrg}
        onCreateOrg={handleCreateOrg}
        onSignOut={handleSignOut}
        activeCard={activeCard}
        onSelectCard={setActiveCard}
      />
      <section style={styles.main}>
        {activeCard === 'devices' && me.permissions['device:list']?.effect === 'allow' && <DevicesCard token={token} orgId={me.orgId} me={me} />}
        {activeCard === 'people' && me.permissions['user:read']?.effect === 'allow' && <PeopleCard token={token} orgId={me.orgId} me={me} />}
        {activeCard === 'grants' && me.permissions['user:read']?.effect === 'allow' && <GrantsCard token={token} orgId={me.orgId} me={me} />}
        {activeCard === 'sessions' && me.permissions['session:view']?.effect === 'allow' && <SessionsCard token={token} orgId={me.orgId} me={me} />}
        {activeCard === 'audit' && me.permissions['audit:read']?.effect === 'allow' && <AuditCard token={token} orgId={me.orgId} />}
        {activeCard === 'admin' && (me.permissions['org:update']?.effect === 'allow' || me.permissions['org:delete']?.effect === 'allow') && (
          <AdminCard token={token} orgId={me.orgId} me={me} onOrgChanged={() => refreshMe(token)} />
        )}
      </section>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);