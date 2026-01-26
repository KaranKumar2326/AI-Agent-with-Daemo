import { google } from "googleapis";
import { DaemoFunction, DaemoSchema } from "daemo-engine";
import { z } from "zod";
import { config } from "../config";


import fs from "fs";
import path from "path";

const keyBase64 = config.google.keyBase64;

const keyJson = Buffer.from(keyBase64, "base64").toString("utf-8");

const keyPath = path.join(process.cwd(), "google-key.json");

fs.writeFileSync(keyPath, keyJson);


/* ===============================
   Schema
================================ */

@DaemoSchema({
  description: "Inventory item schema",
  properties: {
    sku: {
      type: "string",
      description: "Unique stock keeping unit",
    },

    productName: {
      type: "string",
      description: "Name of the product",
    },

    category: {
      type: "string",
      description: "Product category",
    },

    quantity: {
      type: "number",
      description: "Current stock quantity",
    },

    reorderPoint: {
      type: "number",
      description: "Minimum quantity before reorder",
    },
  },
})
class InventoryItem {
  sku = "";
  productName = "";
  category = "";
  quantity = 0;
  price = 0;
  reorderPoint = 0;
}

/* ===============================
   Zod Schemas (Reusable)
================================ */

const InventoryItemSchema = z.object({
  sku: z.string(),
  productName: z.string(),
  category: z.string(),
  quantity: z.number(),
  price: z.number(),
  reorderPoint: z.number(),
});

/* ===============================
   Service
================================ */

export class InventoryService {
  /* ===============================
     Google Sheets Helper
  ================================ */

  private async getSheet() {
    const auth = new google.auth.GoogleAuth({
      keyFile: keyPath,
      scopes: ["https://www.googleapis.com/auth/spreadsheets"],
    });

    const sheets = google.sheets({ version: "v4", auth });

    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: config.google.sheetId,
      range: "Inventory!A:F",
    });

    return {
      sheets,
      rows: res.data.values || [],
    };
  }

  private rowToItem(row: any[], index: number) {
  return {
    sku: row[0] || "",
    productName: row[1] || "",
    category: row[2] || "",
    quantity: parseInt(row[3]) || 0,     // D
    price: parseFloat(row[4]) || 0,      // E (NEW)
    reorderPoint: parseInt(row[5]) || 0, // F (FIXED)
    rowIndex: index,
  };
}

  private cleanItem(item: any) {
  return {
    sku: item.sku,
    productName: item.productName,
    category: item.category,
    quantity: item.quantity,
    price: item.price,
    reorderPoint: item.reorderPoint,
  };
}

  /* ===============================
     Functions
  ================================ */

  // --------------------------------
  // Check Inventory
  // --------------------------------
  @DaemoFunction({
    description: "Check stock by product name",

    inputSchema: z.object({
      productName: z.string().describe("Product name to search"),
    }),

    outputSchema: z.union([
      InventoryItemSchema,

      z.object({
        error: z.string(),
      }),
    ]),
  })
  async checkInventoryStatus(args: { productName: string }) {
    const { rows } = await this.getSheet();

    const row = rows.find(
      (r, i) =>
        i > 0 &&
        r[1]?.toLowerCase().includes(args.productName.toLowerCase())
    );

    if (!row) return { error: "Product not found" };
    const item = this.rowToItem(row, 0);
    return this.cleanItem(item);

  }

  // --------------------------------
  // Modify Stock
  // --------------------------------
  @DaemoFunction({
    description: "Modify stock by SKU",

    inputSchema: z.object({
      sku: z.string().describe("Product SKU"),
      amount: z.number().describe("Quantity to add or remove"),
    }),

    outputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
      newQuantity: z.number().optional(),
    }),
  })
  async modifyStockQuantity(args: { sku: string; amount: number }) {
    const { sheets, rows } = await this.getSheet();

    const index = rows.findIndex(
      (r, i) => i > 0 && r[0] === args.sku
    );

    if (index === -1) {
      return { success: false, message: "SKU not found" };
    }

    const current = parseInt(rows[index][3]) || 0;
    const updated = current + args.amount;

    if (updated < 0) {
      return {
        success: false,
        message: "Not enough stock",
      };
    }

    await sheets.spreadsheets.values.update({
      spreadsheetId: config.google.sheetId,
      range: `Inventory!D${index + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: [[updated]] },
    });

    return {
      success: true,
      message: "Stock updated",
      newQuantity: updated,
    };
  }

  // --------------------------------
  // Get All Inventory
  // --------------------------------
  @DaemoFunction({
    description: "List all inventory",

    inputSchema: z.object({
      category: z.string().optional(),
    }),

    outputSchema: z.array(InventoryItemSchema),
  })
  async getAllInventory(args: { category?: string }) {
    const { rows } = await this.getSheet();

    let items = rows
      .slice(1)
      .map((r, i) => this.rowToItem(r, i + 1));

    if (args.category) {
      items = items.filter(
        (i) =>
          i.category.toLowerCase() ===
          args.category!.toLowerCase()
      );
    }

    return items.map(i => this.cleanItem(i));
  }

  // --------------------------------
  // Low Stock
  // --------------------------------
  @DaemoFunction({
    description: "Find low stock items",

    inputSchema: z.object({}),

    outputSchema: z.array(
      z.object({
        sku: z.string(),
        productName: z.string(),
        quantity: z.number(),
        price : z.number(),
        reorderPoint: z.number(),
      })
    ),
  })
  async getLowStockItems() {
    const { rows } = await this.getSheet();

    return rows
      .slice(1)
      .filter((r) => {
        const q = parseInt(r[3]) || 0;
        const rp = parseInt(r[5]) || 0;
        return q <= rp;
      })
      .map((r, i) => this.cleanItem(this.rowToItem(r, i + 1)));

  }

  // --------------------------------
  // Add Product
  // --------------------------------
  @DaemoFunction({
    description: "Add new product",

    inputSchema: z.object({
      sku: z.string(),
      productName: z.string(),
      category: z.string(),
      quantity: z.number(),
      price: z.number(),
      reorderPoint: z.number(),
    }),

    outputSchema: z.object({
      success: z.boolean(),
      message: z.string(),
    }),
  })
  async addNewProduct(args: {
    sku: string;
    productName: string;
    category: string;
    quantity: number;
    price: number;
    reorderPoint: number;
  }) {
    const { sheets, rows } = await this.getSheet();

    if (rows.some((r, i) => i > 0 && r[0] === args.sku)) {
      return {
        success: false,
        message: "SKU already exists",
      };
    }

    await sheets.spreadsheets.values.append({
      spreadsheetId: config.google.sheetId,
      range: "Inventory!A:F",
      valueInputOption: "USER_ENTERED",
      requestBody: {
        values: [
          [
            args.sku,
            args.productName,
            args.category,
            args.quantity,
            args.price,
            args.reorderPoint,
          ],
        ],
      },
    });

    return {
      success: true,
      message: "Product added",
    };
  }

  // --------------------------------
  // Reorder Suggestion
  // --------------------------------
   // --------------------------------
// Reorder Suggestion
// --------------------------------
@DaemoFunction({
  description:
    "Determine whether any products need reordering. Use this for questions about shortages, restocking, low supply, purchasing, or reorder status.",

  tags: ["inventory", "reorder", "restock", "purchase", "supply"],

  category: "Inventory Management",

  inputSchema: z.object({}),

  outputSchema: z.array(
    z.object({
      sku: z.string(),
      productName: z.string(),
      currentStock: z.number(),
      reorderPoint: z.number(),
      suggestedOrder: z.number(),
    })
  ),
})
async checkAndSuggestReorder() {
  const { rows } = await this.getSheet();

  const lowStock = rows
    .slice(1)
    .map((r, i) => this.rowToItem(r, i + 1))
    .filter((item) => item.quantity <= item.reorderPoint);

  // IMPORTANT: Never return empty array
  if (lowStock.length === 0) {
  return [];
}


  return lowStock.map((item) => ({
    sku: item.sku,
    productName: item.productName,
    currentStock: item.quantity,
    reorderPoint: item.reorderPoint,
    suggestedOrder: Math.max(
      item.reorderPoint * 2 - item.quantity,
      0
    ),
  }));
}


@DaemoFunction({
  description: "Get overall inventory dashboard summary",

  tags: ["summary", "dashboard", "overview", "report"],

  category: "Analytics",

  inputSchema: z.object({}),

  outputSchema: z.object({
    totalProducts: z.number(),
    totalQuantity: z.number(),
    totalValue: z.number(),
    lowStockCount: z.number(),
    outOfStockCount: z.number(),
  }),
})
async getInventorySummary() {
  const { rows } = await this.getSheet();

  const items = rows.slice(1).map((r, i) =>
    this.rowToItem(r, i + 1)
  );

  let totalQty = 0;
  let totalValue = 0;
  let lowStock = 0;
  let outStock = 0;

  for (const item of items) {
    totalQty += item.quantity;
    totalValue += item.quantity * item.price;

    if (item.quantity === 0) outStock++;
    if (item.quantity <= item.reorderPoint) lowStock++;
  }

  return {
    totalProducts: items.length,
    totalQuantity: totalQty,
    totalValue,
    lowStockCount: lowStock,
    outOfStockCount: outStock,
  };
}



@DaemoFunction({
  description: "Find highest priced product",

  tags: ["expensive", "highest price", "premium"],

  category: "Pricing",

  inputSchema: z.object({}),

  outputSchema: InventoryItemSchema,
})
async getMostExpensiveItem() {
  const { rows } = await this.getSheet();

  const items = rows.slice(1).map((r, i) =>
    this.rowToItem(r, i + 1)
  );

  if (!items.length) {
    throw new Error("No inventory data");
  }

  const item = items.reduce((max, cur) =>
  cur.price > max.price ? cur : max
);

return this.cleanItem(item);

}


@DaemoFunction({
  description: "Find lowest priced product",

  tags: ["cheapest", "lowest price", "budget"],

  category: "Pricing",

  inputSchema: z.object({}),

  outputSchema: InventoryItemSchema,
})
async getCheapestItem() {
  const { rows } = await this.getSheet();

  const items = rows.slice(1).map((r, i) =>
    this.rowToItem(r, i + 1)
  );

  if (!items.length) {
    throw new Error("No inventory data");
  }

  const item = items.reduce((min, cur) =>
  cur.price < min.price ? cur : min
);

return this.cleanItem(item);

}



@DaemoFunction({
  description: "Calculate total inventory monetary value",

  tags: ["value", "worth", "money", "finance"],

  category: "Finance",

  inputSchema: z.object({}),

  outputSchema: z.object({
    totalValue: z.number(),
  }),
})
async getInventoryValue() {
  const { rows } = await this.getSheet();

  const items = rows.slice(1).map((r, i) =>
    this.rowToItem(r, i + 1)
  );

  const totalValue = items.reduce(
    (sum, i) => sum + i.quantity * i.price,
    0
  );

  return { totalValue };
}


@DaemoFunction({
  description: "Find products that are out of stock",

  tags: ["out of stock", "sold out", "empty"],

  category: "Alerts",

  inputSchema: z.object({}),

  outputSchema: z.array(InventoryItemSchema),
})
async getOutOfStockItems() {
  const { rows } = await this.getSheet();

  return rows
  .slice(1)
  .map((r, i) => this.cleanItem(this.rowToItem(r, i + 1)))
  .filter(i => i.quantity === 0);

}


@DaemoFunction({
  description: "Find products with highest stock quantity",

  tags: ["highest stock", "bulk", "most items"],

  category: "Analytics",

  inputSchema: z.object({
    limit: z.number().default(5),
  }),

  outputSchema: z.array(InventoryItemSchema),
})
async getTopStockItems(args: { limit: number }) {
  const { rows } = await this.getSheet();

  const items = rows
    .slice(1)
    .map((r, i) => this.rowToItem(r, i + 1))
    .sort((a, b) => b.quantity - a.quantity);

  return items
  .slice(0, args.limit)
  .map(i => this.cleanItem(i));

}

@DaemoFunction({
  description: "Summarize inventory by category",

  tags: ["category", "group", "classification"],

  category: "Analytics",

  inputSchema: z.object({}),

  outputSchema: z.array(
    z.object({
      category: z.string(),
      totalProducts: z.number(),
      totalQuantity: z.number(),
      totalValue: z.number(),
    })
  ),
})
async getCategorySummary() {
  const { rows } = await this.getSheet();

  const items = rows.slice(1).map((r, i) =>
    this.rowToItem(r, i + 1)
  );

  const map: any = {};

  for (const i of items) {
    if (!map[i.category]) {
      map[i.category] = {
        category: i.category,
        totalProducts: 0,
        totalQuantity: 0,
        totalValue: 0,
      };
    }

    map[i.category].totalProducts++;
    map[i.category].totalQuantity += i.quantity;
    map[i.category].totalValue += i.quantity * i.price;
  }

  return Object.values(map);
}


@DaemoFunction({
  description: "Search products by keyword",

  tags: ["search", "find", "lookup"],

  category: "Search",

  inputSchema: z.object({
    keyword: z.string(),
  }),

  outputSchema: z.array(InventoryItemSchema),
})
async searchProducts(args: { keyword: string }) {
  const { rows } = await this.getSheet();

  const key = args.keyword.toLowerCase();

  return rows
  .slice(1)
  .map((r, i) => this.cleanItem(this.rowToItem(r, i + 1)))
  .filter(
    i =>
      i.productName.toLowerCase().includes(key) ||
      i.category.toLowerCase().includes(key) ||
      i.sku.toLowerCase().includes(key)
  );

}

}

