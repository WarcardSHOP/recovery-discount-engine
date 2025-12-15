import express from "express";

const app = express();
app.use(express.json());

const SHOP = process.env.SHOPIFY_SHOP;
const TOKEN = process.env.SHOPIFY_TOKEN;
const SECRET = process.env.ENGINE_SECRET;
const PERCENT = Number(process.env.DISCOUNT_PERCENT || "5");
const HOURS = Number(process.env.DISCOUNT_HOURS || "24");
const COLLECTION_HANDLE = process.env.ELIGIBLE_COLLECTION_HANDLE;

function gql(query, variables) {
  return fetch(`https://${SHOP}/admin/api/2024-07/graphql.json`, {
    method: "POST",
    headers: {
      "X-Shopify-Access-Token": TOKEN,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ query, variables })
  }).then(r => r.json());
}

function randomCode() {
  return "WC-" + Math.random().toString(36).slice(2, 8).toUpperCase();
}

app.post("/create-recovery-code", async (req, res) => {
  try {
    const { secret, email } = req.body || {};
    if (!secret || secret !== SECRET) return res.status(401).json({ ok:false, error:"unauthorized" });
    if (!email) return res.status(400).json({ ok:false, error:"missing email" });
    if (!COLLECTION_HANDLE) return res.status(500).json({ ok:false, error:"missing collection handle" });

    // Customer ID
    const cust = await gql(`
      query($q:String!){
        customers(first:1, query:$q){
          edges{ node{ id } }
        }
      }`, { q: `email:${email}` });
    const customerId = cust?.data?.customers?.edges?.[0]?.node?.id;
    if (!customerId) return res.status(404).json({ ok:false, error:"customer not found" });

    // Collection ID (via handle)
    const col = await gql(`
      query($h:String!){
        collectionByHandle(handle:$h){ id }
      }`, { h: COLLECTION_HANDLE });
    const collectionId = col?.data?.collectionByHandle?.id;
    if (!collectionId) return res.status(404).json({ ok:false, error:"collection not found" });

    const code = randomCode();
    const startsAt = new Date();
    const endsAt = new Date(Date.now() + HOURS * 60 * 60 * 1000);

    // Create discount
    const created = await gql(`
      mutation($input:DiscountCodeBasicInput!){
        discountCodeBasicCreate(basicCodeDiscount:$input){
          discountCodeBasic{ codes(first:1){ nodes{ code } } }
          userErrors{ message }
        }
      }`, {
        input: {
          title: `Recovery ${code}`,
          codes: [code],
          startsAt: startsAt.toISOString(),
          endsAt: endsAt.toISOString(),
          appliesOncePerCustomer: true,
          customerSelection: { customers: [customerId] },
          combinesWith: { orderDiscounts:false, productDiscounts:false, shippingDiscounts:false },
          customerGets: {
            value: { percentage: PERCENT },
            items: { collections: [collectionId] }
          }
        }
      });

    const errs = created?.data?.discountCodeBasicCreate?.userErrors || [];
    if (errs.length) return res.status(500).json({ ok:false, error: errs.map(e=>e.message).join(" | ") });

    res.json({ ok:true, code, percent:PERCENT, hours:HOURS });
  } catch (e) {
    res.status(500).json({ ok:false, error: String(e?.message || e) });
  }
});

app.get("/", (_, res) => res.send("OK"));
app.listen(process.env.PORT || 3000);
