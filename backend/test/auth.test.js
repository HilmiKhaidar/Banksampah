import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";

let server;
const accountIds = [];
let identifier;
let managerCookie;
const setupKey = `test-${randomUUID()}`;
process.env.MANAGER_SETUP_KEY = setupKey;

const [{ pool }, { default: app }] = await Promise.all([
  import("../src/config/database.js"),
  import("../src/app.js"),
]);
const { hashPassword } = await import("../src/services/auth.service.js");
const importedIdentifiers = [];

after(async () => {
  for (const accountId of accountIds) {
    await pool.execute("DELETE FROM akun WHERE id = ?", [accountId]);
  }
  for (const importedIdentifier of importedIdentifiers) {
    await pool.execute("DELETE FROM akun WHERE identitas = ?", [importedIdentifier]);
  }
  if (server?.listening) {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
  await pool.end();
});

test("school-managed accounts, session, profile, password, and logout work with MySQL", async () => {
  server = app.listen(0, "127.0.0.1");
  await new Promise((resolve, reject) => {
    server.once("listening", resolve);
    server.once("error", reject);
  });

  const baseUrl = `http://127.0.0.1:${server.address().port}/api/auth`;
  const businessBaseUrl = `http://127.0.0.1:${server.address().port}/api/business`;
  identifier = `test-${randomUUID()}`;

  async function request(path, { method = "GET", body, cookie, extraHeaders = {} } = {}) {
    const headers = { ...extraHeaders };
    if (body) headers["content-type"] = "application/json";
    if (cookie) headers.cookie = cookie;
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    });
    return {
      response,
      body: await response.json(),
      cookie: response.headers.get("set-cookie")?.split(";")[0],
    };
  }

  const setupState = await request("/setup");
  if (setupState.body.managerSetupAvailable) {
    const invalidManagerKey = await request("/setup-manager", {
      method: "POST",
      extraHeaders: { "x-manager-setup-key": "incorrect-key" },
      body: {
        name: "Temporary API Manager",
        identifier: `manager-invalid-${randomUUID()}`,
        whatsapp: "080000000000",
        password: "password-manager-123",
      },
    });
    assert.equal(invalidManagerKey.response.status, 403);

    const managerRequest = (suffix) => request("/setup-manager", {
      method: "POST",
      extraHeaders: { "x-manager-setup-key": setupKey },
      body: {
        name: "Temporary API Manager",
        identifier: `manager-${suffix}`,
        whatsapp: "080000000000",
        password: "password-manager-123",
      },
    });
    const [firstManager, secondManager] = await Promise.all([
      managerRequest(randomUUID()),
      managerRequest(randomUUID()),
    ]);
    const managerResponses = [firstManager, secondManager];
    const createdManagers = managerResponses.filter((result) => result.response.status === 201);
    const rejectedManagers = managerResponses.filter((result) => result.response.status === 409);
    for (const createdManager of createdManagers) {
      if (createdManager.body.account?.id) accountIds.push(createdManager.body.account.id);
    }
    assert.equal(createdManagers.length, 1);
    assert.equal(rejectedManagers.length, 1);
    managerCookie = createdManagers[0].cookie;

    const unavailableSetup = await request("/setup");
    assert.equal(unavailableSetup.body.managerSetupAvailable, false);
  }
  if (!managerCookie) {
    const managerId = randomUUID();
    const managerIdentifier = `test-manager-${randomUUID()}`;
    accountIds.push(managerId);
    await pool.execute(
      `INSERT INTO akun
        (id, peran, nama, identitas, kelas, whatsapp, hash_kata_sandi, wajib_ganti_kata_sandi)
       VALUES (?, 'pengelola', 'Temporary API Manager', ?, NULL, '080000000000', ?, FALSE)`,
      [managerId, managerIdentifier, await hashPassword("password-manager-123")],
    );
    const managerLogin = await request("/login", {
      method: "POST",
      body: { identifier: managerIdentifier, password: "password-manager-123" },
    });
    assert.equal(managerLogin.response.status, 200);
    managerCookie = managerLogin.cookie;
  }

  const unauthenticated = await request("/session");
  assert.equal(unauthenticated.response.status, 401);
  const unauthenticatedBusiness = await fetch(`${businessBaseUrl}/data`);
  assert.equal(unauthenticatedBusiness.status, 401);

  const publicRegistration = await request("/register", {
    method: "POST",
    body: {
      name: "API Test User",
      identifier,
      className: "Test",
      whatsapp: "080000000000",
      password: "password-lama-123",
    },
  });
  assert.equal(publicRegistration.response.status, 404);

  const studentId = randomUUID();
  accountIds.push(studentId);
  await pool.execute(
    `INSERT INTO akun
      (id, peran, nama, identitas, kelas, whatsapp, hash_kata_sandi, wajib_ganti_kata_sandi)
     VALUES (?, 'peserta', 'API Test User', ?, 'Test', '080000000000', ?, FALSE)`,
    [studentId, identifier, await hashPassword("password-lama-123")],
  );
  const registration = await request("/login", {
    method: "POST",
    body: { identifier, password: "password-lama-123" },
  });
  assert.equal(registration.response.status, 200);
  assert.equal(registration.body.account.identifier, identifier);
  assert.equal("passwordHash" in registration.body.account, false);
  assert.match(registration.cookie ?? "", /^bank_sampah_session=/);

  const sessionCookie = registration.cookie;
  const activeSession = await request("/session", { cookie: sessionCookie });
  assert.equal(activeSession.response.status, 200);
  assert.equal(activeSession.body.account.id, registration.body.account.id);

  const studentBusinessData = await fetch(`${businessBaseUrl}/data`, {
    headers: { cookie: sessionCookie },
  });
  assert.equal(studentBusinessData.status, 200);
  const businessData = await studentBusinessData.json();
  assert.equal(Array.isArray(businessData.wasteTypes), true);
  assert.equal(Array.isArray(businessData.deposits), true);
  assert.equal(Array.isArray(businessData.pointEntries), true);
  assert.equal(Array.isArray(businessData.rewards), true);
  assert.equal(Array.isArray(businessData.redemptionRequests), true);
  assert.equal(
    businessData.deposits.every((deposit) => deposit.studentId === studentId),
    true,
  );
  const forbiddenWasteTypeCreate = await fetch(`${businessBaseUrl}/waste-types`, {
    method: "POST",
    headers: { cookie: sessionCookie, "content-type": "application/json" },
    body: JSON.stringify({
      name: "Student-forbidden waste type",
      unit: "kg",
      pointsPerUnit: 1,
    }),
  });
  assert.equal(forbiddenWasteTypeCreate.status, 403);

  if (managerCookie) {
    const forbiddenStudentList = await request("/students", { cookie: sessionCookie });
    assert.equal(forbiddenStudentList.response.status, 403);
    const forbiddenStudentImport = await request("/students/import", {
      method: "POST",
      cookie: sessionCookie,
      body: { students: [{ name: "Student", identifier: `student-${randomUUID()}` }] },
    });
    assert.equal(forbiddenStudentImport.response.status, 403);
  }

  const crossOriginLogout = await request("/logout", {
    method: "POST",
    cookie: sessionCookie,
    extraHeaders: { origin: "http://untrusted.example" },
  });
  assert.equal(crossOriginLogout.response.status, 403);

  const duplicateIdentifier = `rollback-${randomUUID()}`;
  const duplicate = await request("/students/import", {
    method: "POST",
    cookie: managerCookie,
    body: {
      students: [
        { name: "Will Roll Back", identifier: duplicateIdentifier },
        { name: "Duplicate User", identifier },
      ],
    },
  });
  assert.equal(duplicate.response.status, 409);
  const rolledBackRows = await pool.execute(
    "SELECT id FROM akun WHERE identitas = ?",
    [duplicateIdentifier],
  );
  assert.equal(rolledBackRows[0].length, 0);

  const profile = await request("/profile", {
    method: "PATCH",
    cookie: sessionCookie,
    body: { name: "Updated API User", className: "Test 2", whatsapp: "081234567890" },
  });
  assert.equal(profile.response.status, 200);
  assert.equal(profile.body.account.name, "Updated API User");
  assert.equal(profile.body.account.className, "Test 2");

  const passwordUpdate = await request("/password", {
    method: "PUT",
    cookie: sessionCookie,
    body: { currentPassword: "password-lama-123", newPassword: "password-baru-456" },
  });
  assert.equal(passwordUpdate.response.status, 200);

  const oldPasswordLogin = await request("/login", {
    method: "POST",
    body: { identifier, password: "password-lama-123" },
  });
  assert.equal(oldPasswordLogin.response.status, 401);

  const newPasswordLogin = await request("/login", {
    method: "POST",
    body: { identifier, password: "password-baru-456" },
  });
  assert.equal(newPasswordLogin.response.status, 200);
  const loggedOut = await request("/logout", {
    method: "POST",
    cookie: newPasswordLogin.cookie,
  });
  assert.equal(loggedOut.response.status, 200);

  const endedSession = await request("/session", { cookie: newPasswordLogin.cookie });
  assert.equal(endedSession.response.status, 401);

  if (managerCookie) {
    const studentList = await request("/students", { cookie: managerCookie });
    assert.equal(studentList.response.status, 200);
    assert.equal(studentList.body.students.some((student) => student.id === studentId), true);

    const importedIdentifier = `import-${randomUUID()}`;
    importedIdentifiers.push(importedIdentifier);
    const imported = await request("/students/import", {
      method: "POST",
      cookie: managerCookie,
      body: {
        students: [{ name: "Imported API Student", identifier: importedIdentifier, className: "Test" }],
      },
    });
    assert.equal(imported.response.status, 201);
    assert.equal(imported.body.importedCount, 1);
    assert.equal(imported.body.credentials[0].identifier, importedIdentifier);
    assert.equal(imported.body.credentials[0].temporaryPassword.length >= 8, true);

    const importedRows = await pool.execute(
      "SELECT wajib_ganti_kata_sandi AS mustChange FROM akun WHERE identitas = ?",
      [importedIdentifier],
    );
    assert.equal(Boolean(importedRows[0][0].mustChange), true);
    const temporaryLogin = await request("/login", {
      method: "POST",
      body: {
        identifier: importedIdentifier,
        password: imported.body.credentials[0].temporaryPassword,
      },
    });
    assert.equal(temporaryLogin.response.status, 200);
    assert.equal(temporaryLogin.body.account.passwordChangeRequired, true);
    const blockedBeforePasswordChange = await fetch(`${businessBaseUrl}/data`, {
      headers: { cookie: temporaryLogin.cookie },
    });
    assert.equal(blockedBeforePasswordChange.status, 403);
    const changedTemporaryPassword = await request("/password", {
      method: "PUT",
      cookie: temporaryLogin.cookie,
      body: { newPassword: "Siswa-password-baru-123" },
    });
    assert.equal(changedTemporaryPassword.response.status, 200);
    const changedSession = await request("/session", { cookie: temporaryLogin.cookie });
    assert.equal(changedSession.body.account.passwordChangeRequired, false);
    const oldTemporaryLogin = await request("/login", {
      method: "POST",
      body: {
        identifier: importedIdentifier,
        password: imported.body.credentials[0].temporaryPassword,
      },
    });
    assert.equal(oldTemporaryLogin.response.status, 401);

    const duplicateBatch = await request("/students/import", {
      method: "POST",
      cookie: managerCookie,
      body: {
        students: [
          { name: "Duplicate One", identifier: "same-nisn" },
          { name: "Duplicate Two", identifier: "same-nisn" },
        ],
      },
    });
    assert.equal(duplicateBatch.response.status, 400);

    const disabled = await request(`/students/${studentId}`, {
      method: "PATCH",
      cookie: managerCookie,
      body: {
        name: "Updated API User",
        className: "Test 2",
        whatsapp: "081234567890",
        active: false,
      },
    });
    assert.equal(disabled.response.status, 200);
    assert.equal(disabled.body.student.active, false);

    const revokedSession = await request("/session", { cookie: sessionCookie });
    assert.equal(revokedSession.response.status, 401);
  }
});
