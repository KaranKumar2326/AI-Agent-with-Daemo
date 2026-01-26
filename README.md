
```md
# AI Inventory Management Agent (Daemo)

An AI-powered inventory management system built using Daemo Engine and Node.js.  
This application manages products, stock levels, and analytics through natural language queries.

The system uses Google Sheets as a real-time database and exposes structured tools for inventory operations.

---

## Overview

This project provides an AI agent that enables users to manage inventory using natural language.  
It integrates with Daemo Engine to interpret queries and execute backend functions.

The agent supports product management, reporting, and inventory analysis.

---

## Features

- Add new products
- Update stock quantities
- Check inventory status
- Low stock alerts
- Reorder suggestions
- Category-based analytics
- Price-based analysis
- Google Sheets integration
- Natural language interface

---

## Tech Stack

- Node.js
- TypeScript
- Daemo Engine SDK
- Express.js
- Google Sheets API
- Zod
- GitHub
- Vercel

---

## Project Structure

```text
AI-Agent-with-Daemo/
│
├── src/
│   ├── services/
│   │   ├── daemoService.ts
│   │   └── InventoryService.ts
│   │
│   ├── controller/
│   │   └── agentController.ts
│   │
│   ├── server.ts
│   └── index.ts
│
├── package.json
├── tsconfig.json
├── README.md
└── .env
```

---

## Installation and Setup

### 1. Clone the Repository

```bash
git clone https://github.com/KaranKumar2326/AI-Agent-with-Daemo.git
cd AI-Agent-with-Daemo
````

---

### 2. Install Dependencies

```bash
npm install
```

---

### 3. Environment Variables

Create a `.env` file in the project root.

```env
DAEMO_AGENT_API_KEY=your_daemo_api_key
DAEMO_GATEWAY_URL=https://gateway.daemo.ai

GOOGLE_SHEET_ID=your_google_sheet_id
GOOGLE_KEY_BASE64=your_base64_encoded_key

NODE_ENV=development
```

Do not commit the `.env` file to version control.

---

### 4. Build the Project

```bash
npm run build
```

---

### 5. Start the Server

```bash
npm start
```

The server will run at:

```
http://localhost:4000
```

---

## API Endpoints

### Query Agent

**POST**

```
/agent/query
```

**Request Example**

```json
{
  "query": "How many laptops are in stock?"
}
```

**Response Example**

```json
{
  "response": "We currently have 50 laptops available."
}
```

---

### Stream Response

**POST**

```
/agent/query-stream
```

Supports Server-Sent Events (SSE).

---

## Available Tools

| Tool Name              | Description           |
| ---------------------- | --------------------- |
| addNewProduct          | Add a new product     |
| modifyStockQuantity    | Update stock          |
| checkInventoryStatus   | Check stock           |
| getLowStockItems       | Low stock alerts      |
| getOutOfStockItems     | Out of stock items    |
| checkAndSuggestReorder | Reorder suggestions   |
| getInventorySummary    | Inventory summary     |
| getCategorySummary     | Category summary      |
| getMostExpensiveItem   | Highest priced item   |
| getCheapestItem        | Lowest priced item    |
| getInventoryValue      | Total inventory value |
| searchProducts         | Product search        |
| getTopStockItems       | Top stock items       |

---

## Example Prompts

Example queries that can be used with the agent:

```
Add a new product with:
SKU: TEST-001
ProductName: Test Item
Category: Demo
Quantity: 10
Price: 100
ReorderPoint: 2
 
```

```
Which products are low in stock?
```

```
Tell me highest and lowest price product details
```

```
What is the total inventory value?
```

```
Find wireless electronics
```

---

## Deployment

### Deploy on Vercel

1. Connect this repository to Vercel
2. Configure environment variables
3. Deploy the project

For long-running Daemo connections, consider platforms such as Render, Railway, or Google Cloud Run.

---

## Security Best Practices

* Keep API keys private
* Use environment variables for secrets
* Enable HTTPS in production
* Protect endpoints with authentication
* Restrict public access when required

---

## Development

Run the project in development mode:

```bash
npm run dev
```

Restart the agent after modifying tools or schemas.

---

## Contributing

Contributions are welcome.

1. Fork the repository
2. Create a feature branch
3. Commit your changes
4. Submit a pull request

---


---

## Author

Karan Kumar
GitHub: [https://github.com/KaranKumar2326](https://github.com/KaranKumar2326)

---

## Support

If you find this project useful, consider starring the repository.

```

