import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { test } from "node:test";

const [{ pool }, { default: app }] = await Promise.all([
  import("../src/config/database.js"),
  import("../src/app.js"),
]);

test("business API completes a deposit-to-redemption flow with point and stock checks", async (t) => {
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
  const studentIdentifier = `business-test-${randomUUID()}`;
  const managerToken = randomUUID();
  const studentToken = randomUUID();
  const managerTokenHash = createHash("sha256").update(managerToken).digest("hex");
  const studentTokenHash = createHash("sha256").update(studentToken).digest("hex");
  const uniqueSuffix = randomUUID();
  const wasteName = `Test waste ${uniqueSuffix}`;
  const rewardName = `Test reward ${uniqueSuffix}`;
  let originalConversionSetting;
  let wasteTypeId;
  let rewardId;
  let server;

  try {
    await pool.execute(
      `INSERT INTO akun (id, peran, nama, identitas, kelas, whatsapp, hash_kata_sandi)
       VALUES (?, 'peserta', 'Business API Test Student', ?, 'Test', '080000000000', 'unused-test-hash')`,
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

    const [conversionRows] = await pool.execute(
      "SELECT rupiah_per_poin AS rupiahPerPoint, diperbarui_oleh AS updatedBy FROM pengaturan_bank_sampah WHERE id = 1",
    );
    originalConversionSetting = conversionRows[0];
    const initialBusinessData = await request("/data");
    assert.equal(initialBusinessData.body.preferences.rupiahPerPoint, originalConversionSetting.rupiahPerPoint === null
      ? null
      : Number(originalConversionSetting.rupiahPerPoint));
    const updatedConversion = await request("/conversion-rate", {
      method: "PATCH",
      token: managerToken,
      body: { rupiahPerPoint: 10 },
    });
    assert.equal(updatedConversion.response.status, 200);
    assert.equal(updatedConversion.body.rupiahPerPoint, 10);
    const forbiddenConversion = await request("/conversion-rate", {
      method: "PATCH",
      body: { rupiahPerPoint: 5 },
    });
    assert.equal(forbiddenConversion.response.status, 403);
    const invalidConversion = await request("/conversion-rate", {
      method: "PATCH",
      token: managerToken,
      body: { rupiahPerPoint: 0 },
    });
    assert.equal(invalidConversion.response.status, 400);
    const dataAfterConversion = await request("/data");
    assert.equal(dataAfterConversion.body.preferences.rupiahPerPoint, 10);

    const rejectedPcsWaste = await request("/waste-types", {
      method: "POST",
      token: managerToken,
      body: {
        name: `Test PCS waste ${uniqueSuffix}`,
        unit: "buah",
        pointsPerUnit: 1,
      },
    });
    assert.equal(rejectedPcsWaste.response.status, 400);
    assert.equal(rejectedPcsWaste.body.error.code, "INVALID_UNIT");

    const createdWaste = await request("/waste-types", {
      method: "POST",
      token: managerToken,
      body: {
        name: wasteName,
        unit: "kg",
        pointsPerUnit: 12,
        icon: "♻️",
        image: "data:image/jpeg;base64,/9j/2Q==",
      },
    });
    assert.equal(createdWaste.response.status, 201);
    wasteTypeId = createdWaste.body.wasteType.id;
    assert.match(createdWaste.body.wasteType.image, /^\/api\/business\/waste-types\/.+\/image$/);
    const rejectedPcsUpdate = await request(`/waste-types/${wasteTypeId}`, {
      method: "PATCH",
      token: managerToken,
      body: {
        name: wasteName,
        unit: "buah",
        pointsPerUnit: 12,
        icon: "♻️",
        image: null,
        active: true,
      },
    });
    assert.equal(rejectedPcsUpdate.response.status, 400);
    assert.equal(rejectedPcsUpdate.body.error.code, "INVALID_UNIT");
    const wasteImage = await fetch(`http://127.0.0.1:${server.address().port}${createdWaste.body.wasteType.image}`, {
      headers: { cookie: `bank_sampah_session=${studentToken}` },
    });
    assert.equal(wasteImage.status, 200);
    assert.equal(wasteImage.headers.get("content-type"), "image/jpeg");
    assert.equal(Buffer.from(await wasteImage.arrayBuffer()).toString("base64"), "/9j/2Q==");

    const createdReward = await request("/rewards", {
      method: "POST",
      token: managerToken,
      body: {
        name: rewardName,
        description: "Business API integration test",
        kind: "item",
        pointsCost: 20,
        stock: 2,
        moneyAmount: null,
      },
    });
    assert.equal(createdReward.response.status, 201);
    rewardId = createdReward.body.reward.id;

    const depositResult = await request("/deposits", {
      method: "POST",
      body: {
        wasteTypeIds: [wasteTypeId],
        photos: [{ name: "sample.jpg", dataUrl: "data:image/jpeg;base64,/9j/2Q==" }],
      },
    });
    assert.equal(depositResult.response.status, 201);
    const depositId = depositResult.body.deposit.id;
    assert.equal(depositResult.body.deposit.photos.length, 0);
    const depositPhotos = await request(`/deposits/${depositId}/photos`);
    assert.deepEqual(depositPhotos.body.photos, ["data:image/jpeg;base64,/9j/2Q=="]);

    const approval = await request(`/deposits/${depositId}/review`, {
      method: "POST",
      token: managerToken,
      body: {
        decision: "approve",
        lines: [{ wasteTypeId, quantity: 2.5 }],
        note: "",
      },
    });
    assert.equal(approval.response.status, 200);

    const afterDeposit = await request("/data");
    assert.equal(afterDeposit.response.status, 200);
    const depositEntry = afterDeposit.body.pointEntries.find((entry) => entry.depositId === depositId);
    assert.equal(depositEntry.amount, 30);
    const approvedDeposit = afterDeposit.body.deposits.find((entry) => entry.id === depositId);
    assert.equal(approvedDeposit.status, "approved");
    assert.equal(approvedDeposit.lines[0].quantity, 2.5);
    assert.equal(approvedDeposit.lines[0].pointsAwarded, 30);
    assert.equal(approvedDeposit.photoCount, 1);

    const redemptionResult = await request("/redemptions", {
      method: "POST",
      body: { rewardId },
    });
    assert.equal(redemptionResult.response.status, 201);
    const redemptionId = redemptionResult.body.redemptionRequest.id;

    const overReservedRequest = await request("/redemptions", {
      method: "POST",
      body: { rewardId },
    });
    assert.equal(overReservedRequest.response.status, 409);
    assert.equal(overReservedRequest.body.error.code, "INSUFFICIENT_POINTS");

    const redemptionApproval = await request(`/redemptions/${redemptionId}/review`, {
      method: "POST",
      token: managerToken,
      body: { decision: "approve", note: "" },
    });
    assert.equal(redemptionApproval.response.status, 200);
    const duplicateApproval = await request(`/redemptions/${redemptionId}/review`, {
      method: "POST",
      token: managerToken,
      body: { decision: "approve", note: "" },
    });
    assert.equal(duplicateApproval.response.status, 409);

    const fulfillment = await request(`/redemptions/${redemptionId}/fulfill`, {
      method: "POST",
      token: managerToken,
    });
    assert.equal(fulfillment.response.status, 200);

    const finalData = await request("/data");
    assert.equal(finalData.response.status, 200);
    assert.equal(finalData.body.pointEntries.reduce((sum, entry) => sum + entry.amount, 0), 10);
    const monthlyRanking = await request("/ranking/monthly");
    assert.equal(monthlyRanking.response.status, 200);
    assert.match(monthlyRanking.body.month, /^\d{4}-\d{2}$/);
    assert.equal(
      monthlyRanking.body.ranking.find((entry) => entry.studentId === studentId).points,
      30,
    );
    const managerRanking = await request("/ranking/monthly", { token: managerToken });
    assert.equal(managerRanking.response.status, 403);
    assert.equal(
      finalData.body.redemptionRequests.find((entry) => entry.id === redemptionId).status,
      "fulfilled",
    );
    const savedReward = finalData.body.rewards.find((entry) => entry.id === rewardId);
    assert.equal(savedReward.stock, 1);
    assert.equal(
      finalData.body.pointEntries.filter((entry) => entry.redemptionId === redemptionId).length,
      1,
    );
    assert.equal(finalData.body.preferences.inAppNotifications, true);
    assert.equal(typeof finalData.body.preferences.managerWhatsapp, "string");
    assert.equal(finalData.body.notifications.length > 0, true);
    const disableNotifications = await request("/preferences", {
      method: "PATCH",
      body: { inAppNotifications: false },
    });
    assert.equal(disableNotifications.response.status, 200);
    const preferencesData = await request("/data");
    assert.equal(preferencesData.body.preferences.inAppNotifications, false);
    assert.equal(preferencesData.body.notifications.length, 0);
    const enableNotifications = await request("/preferences", {
      method: "PATCH",
      body: { inAppNotifications: true },
    });
    assert.equal(enableNotifications.response.status, 200);

  } finally {
    if (originalConversionSetting) {
      await pool.execute(
        `UPDATE pengaturan_bank_sampah
         SET rupiah_per_poin = ?, diperbarui_oleh = ?
         WHERE id = 1`,
        [originalConversionSetting.rupiahPerPoint, originalConversionSetting.updatedBy],
      );
    }
    if (server?.listening) {
      await new Promise((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
    await pool.execute(
      `DELETE FROM notifikasi
       WHERE penerima_id = ? OR id_terkait IN (
         SELECT id FROM pengajuan_setoran WHERE peserta_id = ?
         UNION
         SELECT id FROM pengajuan_penukaran WHERE peserta_id = ?
       )`,
      [studentId, studentId, studentId],
    );
    await pool.execute("DELETE FROM transaksi_poin WHERE peserta_id = ?", [studentId]);
    await pool.execute("DELETE FROM pengajuan_penukaran WHERE peserta_id = ?", [studentId]);
    await pool.execute("DELETE FROM pengajuan_setoran WHERE peserta_id = ?", [studentId]);
    if (rewardId) await pool.execute("DELETE FROM katalog_reward WHERE id = ?", [rewardId]);
    else await pool.execute("DELETE FROM katalog_reward WHERE nama = ?", [rewardName]);
    if (wasteTypeId) await pool.execute("DELETE FROM jenis_sampah WHERE id = ?", [wasteTypeId]);
    else await pool.execute("DELETE FROM jenis_sampah WHERE nama = ?", [wasteName]);
    await pool.execute(
      "DELETE FROM sesi WHERE hash_token IN (?, ?)",
      [managerTokenHash, studentTokenHash],
    );
    await pool.execute("DELETE FROM akun WHERE id = ?", [studentId]);
    await pool.end();
  }
});
