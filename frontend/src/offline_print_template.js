/* global frappe */
import { getPrintTemplate, getTermsAndConditions, memoryInitPromise } from "./offline/index.js";
import nunjucks from "nunjucks";

function normaliseTemplate(template) {
	// Nunjucks doesn't understand Python-style triple quotes.
	// Convert any """multiline""" strings to standard JS strings so the
	// renderer can parse templates that include SQL or other blocks.
	if (!template) return template;
	return template.replace(/"""([\s\S]*?)"""/g, (_, str) => {
		const escaped = str.replace(/\\/g, "\\\\").replace(/"/g, '\\"').replace(/\r?\n/g, "\\n");
		return `"${escaped}"`;
	});
}

function attachFormatter(obj) {
	if (!obj || typeof obj !== "object" || obj.get_formatted) return;
	// mimic Frappe's get_formatted by returning the raw field value
	obj.get_formatted = function (field) {
		return this?.[field];
	};
}

function computePaidAmount(doc) {
	if (!doc) return 0;

	const paymentsTotal = (doc.payments || []).reduce(
		(sum, p) => sum + Math.abs(parseFloat(p.amount) || 0),
		0,
	);

	const creditSale =
		doc.is_credit_sale === true ||
		doc.is_credit_sale === 1 ||
		doc.is_credit_sale === "1" ||
		String(doc.is_credit_sale).toLowerCase() === "yes";

	if (creditSale || paymentsTotal === 0) {
		return 0;
	}

	const base = doc.paid_amount ?? doc.grand_total ?? 0;
	return paymentsTotal || base;
}

function defaultOfflineHTML(invoice, terms = "") {
	if (!invoice) return "";

	const itemsRows = (invoice.items || [])
		.map((it) => {
			const sn = it.serial_no
				? `<div class="serial">SR.No: ${it.serial_no.replace(/\n/g, ", ")}</div>`
				: "";
			const marker =
				invoice.posa_show_custom_name_marker_on_print && it.name_overridden ? " (custom)" : "";
			return `<tr>
                <td>${it.item_code}${
					it.item_name && it.item_name !== it.item_code
						? `<div class="item-name">${it.item_name}${marker}</div>`
						: ""
				}${sn}</td>
                <td class="qty">${it.qty} ${it.uom || ""}</td>
                <td class="rate">${it.rate}</td>
                <td class="amount">${it.amount}</td>
            </tr>`;
		})
		.join("");

	const taxesRows = (invoice.taxes || [])
		.map(
			(row) => `<tr>
                <td style="width:60%">${row.description}@${row.rate}%</td>
                <td style="width:40%; text-align:right;">${row.tax_amount}</td>
            </tr>`,
		)
		.join("");

	const discountRow = invoice.discount_amount
		? `<tr>
                <td style="width:60%">Discount</td>
                <td style="width:40%; text-align:right;">${invoice.discount_amount}</td>
            </tr>`
		: "";

	const changeRow = invoice.change_amount
		? `<tr>
                <td style="width:60%">Change Amount</td>
                <td style="width:40%; text-align:right;">${invoice.change_amount}</td>
            </tr>`
		: "";

	const termsSection = terms
		? `<div class="terms"><strong>Terms & Conditions</strong><div>${terms}</div></div>`
		: "";

	const paidAmount = computePaidAmount(invoice);

	return `<!DOCTYPE html>
<html>
<head>
    <meta charset="utf-8">
    <title>Invoice ${invoice.name || ""}</title>
    <style>
        body { font-family: Arial, sans-serif; width: 80mm; margin: 0 auto; padding: 5mm; }
        .header { text-align: center; }
        .header h2 { margin: 0; }
        .info { margin-bottom: 4px; }
        .info div { font-size: 12px; line-height: 1.2; }
        table { width: 100%; border-collapse: collapse; }
        th, td { font-size: 12px; padding: 4px 0; border-bottom: 1px dashed #ccc; }
        th { text-align: left; }
        td.qty, td.rate, td.amount { text-align: right; }
        table.totals td { border-bottom: none; }
        .terms { margin-top: 8px; font-size: 10px; }
        .footer { text-align: center; margin-top: 8px; font-size: 11px; }
    </style>
</head>
<body>
    <div class="header">
        <h2>${invoice.company || "Invoice"}</h2>
        <p><strong>${invoice.is_duplicate ? "Duplicate" : "Original"}</strong></p>
    </div>
    <div class="info">
        <div><strong>Invoice:</strong> ${invoice.name || ""}</div>
        <div><strong>Date:</strong> ${invoice.posting_date || ""} ${invoice.posting_time || ""}</div>
        <div><strong>Customer:</strong> ${invoice.customer_name || invoice.customer || ""}</div>
        <div><strong>Mobile:</strong> ${invoice.contact_mobile || ""}</div>
        <div><strong>Additional Note:</strong> ${invoice.posa_notes || ""}</div>
    </div>
    <table class="items">
        <thead>
            <tr>
                <th style="width:40%">Item</th>
                <th style="width:20%; text-align:right;">Qty</th>
                <th style="width:20%; text-align:right;">Rate</th>
                <th style="width:20%; text-align:right;">Amt</th>
            </tr>
        </thead>
        <tbody>${itemsRows}</tbody>
    </table>
    <table class="totals">
        <tbody>
            ${taxesRows}
            ${discountRow}
            <tr>
                <td style="width:60%"><strong>Total</strong></td>
                <td style="width:40%; text-align:right;">${invoice.grand_total}</td>
            </tr>
            <tr>
                <td style="width:60%">Paid</td>
                <td style="width:40%; text-align:right;">${paidAmount}</td>
            </tr>
            ${changeRow}
        </tbody>
    </table>
    ${termsSection}
    <div class="footer">Thank you, please visit again.</div>
	<P> ELIAS AL SHIABANI </P>
    <script>
    (function(){
  // بيانات الفاتورة التجريبية
  const doc = {
    company: "${invoice.company || "Invoice"}",
    tax_id: "1234567890",
    posting_date: "${invoice.posting_date || ""} ${invoice.posting_time || ""}",
    grand_total: ${invoice.grand_total},
    total_taxes_and_charges: 1.0
  };

  // دالة TLV
  function toTLV(tag, value) {
    const encoder = new TextEncoder();
    const val = encoder.encode(value);
    return [tag, val.length, ...val];
  }

  // تحويل إلى Base64
  function base64FromBytes(bytes) {
    let binary = "";
    for (let i = 0; i < bytes.length; i++) {
      binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
  }

  // إنشاء بيانات ZATCA
  function generateZATCAData(doc) {
    const tlv = [
      ...toTLV(1, doc.company || ""),
      ...toTLV(2, doc.tax_id || ""),
      ...toTLV(3, doc.posting_date || new Date().toISOString()),
      ...toTLV(4, (doc.grand_total || 0).toFixed(2)),
      ...toTLV(5, (doc.total_taxes_and_charges || 0).toFixed(2))
    ];
    return base64FromBytes(tlv);
  }

  const data = generateZATCAData(doc);

  // إنشاء div للباركود وإضافته للصفحة
  const container = document.createElement('div');
  container.id = 'zatca_qr';
  container.style.textAlign = 'center';
  container.style.margin = '10px 0';
  document.body.appendChild(container);

  // إضافة مكتبة QRCode.js إذا لم تكن موجودة
  if (!window.QRCode) {
    const script = document.createElement('script');
    script.src = "https://cdnjs.cloudflare.com/ajax/libs/qrcodejs/1.0.0/qrcode.min.js";
    script.onload = generateQR;
    document.body.appendChild(script);
  } else {
    generateQR();
  }

  function generateQR() {
    const qr = new QRCode(container, {
      text: data,
      width: 128,
      height: 128,
      correctLevel: QRCode.CorrectLevel.L
    });

    // تحويل canvas إلى img لزيادة التوافق
    setTimeout(() => {
      const canvas = container.querySelector('canvas');
      if (canvas) {
        const img = document.createElement('img');
        img.src = canvas.toDataURL("image/png");
        container.innerHTML = '';
        container.appendChild(img);
      }
    }, 200);
  }

})();

    </script>
      
</body>
</html>`;
}

export default async function renderOfflineInvoiceHTML(invoice) {
	if (!invoice) return "";

	await memoryInitPromise;

	const template = normaliseTemplate(getPrintTemplate());
	const terms = getTermsAndConditions();
	const doc = {
		...invoice,
		terms: invoice.terms || terms,
		terms_and_conditions: invoice.terms_and_conditions || terms,
	};

	doc.paid_amount = computePaidAmount(doc);
	attachFormatter(doc);
	(doc.items || []).forEach(attachFormatter);
	(doc.taxes || []).forEach(attachFormatter);

	if (!template) {
		console.warn("No offline print template cached; using fallback template");
		return defaultOfflineHTML(doc, doc.terms_and_conditions);
	}

	try {
		const env = nunjucks.configure({ autoescape: false });
		env.addFilter("format_currency", (value, currency) => {
			const number = typeof value === "number" ? value : parseFloat(value);
			if (Number.isNaN(number)) return value;
			try {
				return new Intl.NumberFormat(undefined, {
					style: currency ? "currency" : "decimal",
					currency: currency || undefined,
				}).format(number);
			} catch {
				return currency ? `${currency} ${number}` : String(number);
			}
		});
		env.addFilter("currency", (value, currency) => env.filters.format_currency(value, currency));
		env.getFilter = function (name) {
			return this.filters[name] || ((v) => v);
		};

		const context = {
			doc,
			terms: doc.terms,
			terms_and_conditions: doc.terms_and_conditions,
			_: frappe?._ ? frappe._ : (t) => t,
			frappe: {
				db: { get_value: () => "", sql: () => [] },
				get_list: () => [],
			},
		};
		return env.renderString(template, context);
	} catch (e) {
		console.error("Failed to render offline invoice", e);
		return defaultOfflineHTML(doc, doc.terms_and_conditions);
	}
}
