import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";

const [{ pool }, { default: app }] = await Promise.all([
  import("../src/config/database.js"),
  import("../src/app.js"),
]);

test("business API credits deposits to a rupiah balance and pays withdrawals", async (t) => {
  const [managers] = await pool.execute(
    "SELECT id FROM akun WHERE peran = 'pengelola' AND aktif = TRUE ORDER BY dibuat_pada LIMIT 1",
  );
  if (managers.length === 0) {
    t.skip("Akun pengelola aktif diperlukan untuk menguji alur bisnis.");
    await pool.end();
    return;
  }

  const managerId = managers[0].id;
  const studentId = randomUUID();
  const managerToken = randomUUID();
  const studentToken = randomUUID();
  const managerTokenHash = createHash("sha256").update(managerToken).digest("hex");
  const studentTokenHash = createHash("sha256").update(studentToken).digest("hex");
  const suffix = randomUUID();
  const studentIdentifier = `cash-test-${suffix}`;
  let wasteTypeId;
  let depositId;
  let unlistedDepositId;
  let rejectedDepositId;
  let withdrawalId;
  let server;

  try {
    await pool.execute(
      `INSERT INTO akun (id, peran, nama, identitas, kelas, whatsapp, hash_kata_sandi)
       VALUES (?, 'peserta', 'Cash API Test Student', ?, 'Test', '080000000000', 'unused-test-hash')`,
      [studentId, studentIdentifier],
    );
    await pool.execute(
      `INSERT INTO sesi (hash_token, akun_id, kedaluwarsa_pada)
       VALUES (?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR)),
              (?, ?, DATE_ADD(CURRENT_TIMESTAMP(3), INTERVAL 1 HOUR))`,
      [managerTokenHash, managerId, studentTokenHash, studentId],
    );

    server = app.listen(0, "127.0.0.1");
    await new Promise((resolve, reject) => {
      server.once("listening", resolve);
      server.once("error", reject);
    });
    const baseUrl = `http://127.0.0.1:${server.address().port}/api/business`;

    async function request(path, { method = "GET", body, token = studentToken } = {}) {
      const headers = { cookie: `bank_sampah_session=${token}` };
      if (body !== undefined) headers["content-type"] = "application/json";
      const response = await fetch(`${baseUrl}${path}`, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { response, body: await response.json() };
    }

    const createdWasteType = await request("/waste-types", {
      method: "POST",
      token: managerToken,
      body: { name: `Cash test ${suffix}`, unit: "kg", pricePerUnit: 2_500 },
    });
    assert.equal(createdWasteType.response.status, 201);
    wasteTypeId = createdWasteType.body.wasteType.id;

    const createdDeposit = await request("/deposits", {
      method: "POST",
      body: { wasteTypeIds: [wasteTypeId] },
    });
    assert.equal(createdDeposit.response.status, 201);
    depositId = createdDeposit.body.deposit.id;

    const approvedDeposit = await request(`/deposits/${depositId}/review`, {
      method: "POST",
      token: managerToken,
      body: {
        decision: "approve",
        lines: [{ wasteTypeId, quantity: 1.5 }],
        note: "",
      },
    });
    assert.equal(approvedDeposit.response.status, 200);

    const emptyUnlistedDeposit = await request("/deposits", {
      method: "POST",
      body: { wasteTypeIds: [], otherWasteDescription: "  " },
    });
    assert.equal(emptyUnlistedDeposit.response.status, 400);

    const createdUnlistedDeposit = await request("/deposits", {
      method: "POST",
      body: { wasteTypeIds: [], otherWasteDescription: "Botol kaca warna hijau" },
    });
    assert.equal(createdUnlistedDeposit.response.status, 201);
    unlistedDepositId = createdUnlistedDeposit.body.deposit.id;
    assert.equal(createdUnlistedDeposit.body.deposit.lines[0].wasteTypeId, null);
    assert.equal(createdUnlistedDeposit.body.deposit.lines[0].wasteTypeName, "Botol kaca warna hijau");

    const approvedUnlistedDeposit = await request(`/deposits/${unlistedDepositId}/review`, {
      method: "POST",
      token: managerToken,
      body: {
        decision: "approve",
        lines: [{ wasteTypeId, quantity: 0.5 }],
        note: "",
      },
    });
    assert.equal(approvedUnlistedDeposit.response.status, 200);

    const createdRejectedDeposit = await request("/deposits", {
      method: "POST",
      body: { wasteTypeIds: [], otherWasteDescription: "Jenis yang tidak dapat diterima" },
    });
    assert.equal(createdRejectedDeposit.response.status, 201);
    rejectedDepositId = createdRejectedDeposit.body.deposit.id;
    const rejectedDeposit = await request(`/deposits/${rejectedDepositId}/review`, {
      method: "POST",
      token: managerToken,
      body: { decision: "reject", note: "Tidak dapat diterima" },
    });
    assert.equal(rejectedDeposit.response.status, 200);

    const balanceAfterDeposit = await request("/data");
    assert.equal(
      balanceAfterDeposit.body.walletEntries.reduce((sum, entry) => sum + entry.amount, 0),
      5_000,
    );
    const mappedDeposit = balanceAfterDeposit.body.deposits.find((deposit) => deposit.id === unlistedDepositId);
    assert.equal(mappedDeposit.lines[0].wasteTypeId, wasteTypeId);
    assert.equal(mappedDeposit.lines[0].wasteTypeName, `Cash test ${suffix}`);
    assert.equal(mappedDeposit.lines[0].amount, 1_250);
    assert.equal(
      balanceAfterDeposit.body.deposits.find((deposit) => deposit.id === rejectedDepositId).status,
      "rejected",
    );
    assert.equal("pointEntries" in balanceAfterDeposit.body, false);
    assert.equal("rewardCatalog" in balanceAfterDeposit.body, false);
    assert.equal("preferences" in balanceAfterDeposit.body, true);

    const createdWithdrawal = await request("/withdrawals", {
      method: "POST",
      body: {
        amount: 3_000,
        destinationType: "bank",
        institution: "Test Bank",
        accountName: "Cash API Test Student",
        accountNumber: "1234567890",
      },
    });
    assert.equal(createdWithdrawal.response.status, 201);
    withdrawalId = createdWithdrawal.body.withdrawalRequest.id;

    const oversizedEdit = await request(`/withdrawals/${withdrawalId}`, {
      method: "PATCH",
      body: {
        amount: 6_000,
        destinationType: "bank",
        institution: "Test Bank",
        accountName: "Cash API Test Student",
        accountNumber: "1234567890",
      },
    });
    assert.equal(oversizedEdit.response.status, 409);

    const approvedWithdrawal = await request(`/withdrawals/${withdrawalId}/review`, {
      method: "POST",
      token: managerToken,
      body: { decision: "approve", note: "" },
    });
    assert.equal(approvedWithdrawal.response.status, 200);

    const paidWithdrawal = await request(`/withdrawals/${withdrawalId}/pay`, {
      method: "POST",
      token: managerToken,
    });
    assert.equal(paidWithdrawal.response.status, 200);

    const finalData = await request("/data");
    assert.equal(
      finalData.body.walletEntries.reduce((sum, entry) => sum + entry.amount, 0),
      2_000,
    );
    assert.equal(finalData.body.withdrawalRequests[0].status, "paid");
    assert.equal((await request("/rewards", { token: managerToken })).response.status, 404);
  } finally {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    if (withdrawalId) {
      await pool.execute("DELETE FROM arsip_transaksi_saldo WHERE pengajuan_pencairan_id = ?", [withdrawalId]);
      await pool.execute("DELETE FROM arsip_pengajuan_pencairan WHERE id = ?", [withdrawalId]);
    }
    if (depositId) {
      await pool.execute("DELETE FROM arsip_transaksi_saldo WHERE setoran_id = ?", [depositId]);
      await pool.execute("DELETE FROM foto_setoran WHERE setoran_id = ?", [depositId]);
      await pool.execute("DELETE FROM rincian_setoran WHERE setoran_id = ?", [depositId]);
      await pool.execute("DELETE FROM pengajuan_setoran WHERE id = ?", [depositId]);
    }
    for (const id of [unlistedDepositId, rejectedDepositId]) {
      if (!id) continue;
      await pool.execute("DELETE FROM arsip_transaksi_saldo WHERE setoran_id = ?", [id]);
      await pool.execute("DELETE FROM foto_setoran WHERE setoran_id = ?", [id]);
      await pool.execute("DELETE FROM rincian_setoran WHERE setoran_id = ?", [id]);
      await pool.execute("DELETE FROM pengajuan_setoran WHERE id = ?", [id]);
    }
    if (wasteTypeId) await pool.execute("DELETE FROM jenis_sampah WHERE id = ?", [wasteTypeId]);
    await pool.execute("DELETE FROM sesi WHERE hash_token IN (?, ?)", [managerTokenHash, studentTokenHash]);
    await pool.execute("DELETE FROM akun WHERE id = ?", [studentId]);
    await pool.end();
  }
});
