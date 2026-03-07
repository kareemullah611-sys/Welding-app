"use client";
import React, { createContext, useContext, useState, useEffect, ReactNode } from "react";

type Lang = "en" | "ps" | "ur";

const translations: Record<string, Record<Lang, string>> = {
  // Navigation
  "Dashboard": { en: "Dashboard", ps: "ډشبورډ", ur: "ڈیش بورڈ" },
  "Lots": { en: "Lots", ps: "لاټونه", ur: "لاٹ" },
  "Lot Costing": { en: "Lot Costing", ps: "د لاټ لګښت", ur: "لاٹ لاگت" },
  "Suppliers": { en: "Suppliers", ps: "عرضه کوونکي", ur: "سپلائرز" },
  "Company Payments": { en: "Company Payments", ps: "د شرکت تادیات", ur: "کمپنی ادائیگیاں" },
  "Agents": { en: "Agents", ps: "ایجنټان", ur: "ایجنٹس" },
  "Country Ledger": { en: "Country Ledger", ps: "د هیواد کھاته", ur: "ملکی کھاتہ" },
  "Sales": { en: "Sales", ps: "پلورنه", ur: "فروخت" },
  "Payments": { en: "Payments", ps: "تادیات", ur: "ادائیگیاں" },
  "Customers": { en: "Customers", ps: "پیرودونکي", ur: "گاہک" },
  "Godowns": { en: "Godowns", ps: "ګدامونه", ur: "گودام" },
  "Inventory": { en: "Inventory", ps: "زېرمه", ur: "انوینٹری" },
  "City Transfers": { en: "City Transfers", ps: "د ښار لیږدونه", ur: "شہر ٹرانسفر" },
  "Profit Report": { en: "Profit Report", ps: "د ګټې راپور", ur: "منافع رپورٹ" },
  "Financial Reports": { en: "Financial Reports", ps: "مالي راپورونه", ur: "مالی رپورٹیں" },
  "Reports": { en: "Reports", ps: "راپورونه", ur: "رپورٹیں" },
  "Search": { en: "Search", ps: "لټون", ur: "تلاش" },
  "Settings": { en: "Settings", ps: "تنظیمات", ur: "ترتیبات" },

  // Common actions
  "Create": { en: "Create", ps: "جوړول", ur: "بنائیں" },
  "Edit": { en: "Edit", ps: "سمون", ur: "ترمیم" },
  "Delete": { en: "Delete", ps: "ړنګول", ur: "حذف" },
  "Save": { en: "Save", ps: "خوندي کول", ur: "محفوظ" },
  "Cancel": { en: "Cancel", ps: "لغوه", ur: "منسوخ" },
  "Loading...": { en: "Loading...", ps: "بار کېږي...", ur: "لوڈ ہو رہا ہے..." },
  "Confirm": { en: "Confirm", ps: "تایید", ur: "تصدیق" },
  "Back": { en: "Back", ps: "شاته", ur: "واپس" },
  "All": { en: "All", ps: "ټول", ur: "سب" },
  "Total": { en: "Total", ps: "ټول", ur: "کل" },
  "Active": { en: "Active", ps: "فعال", ur: "فعال" },
  "Completed": { en: "Completed", ps: "بشپړ", ur: "مکمل" },
  "Pending": { en: "Pending", ps: "پاتې", ur: "زیر التوا" },
  "Status": { en: "Status", ps: "حالت", ur: "حالت" },
  "Date": { en: "Date", ps: "نېټه", ur: "تاریخ" },
  "Amount": { en: "Amount", ps: "مقدار", ur: "رقم" },
  "Detail": { en: "Detail", ps: "تفصیل", ur: "تفصیل" },
  "Notes": { en: "Notes", ps: "یادښتونه", ur: "نوٹس" },
  "Actions": { en: "Actions", ps: "عملونه", ur: "ایکشن" },
  "Name": { en: "Name", ps: "نوم", ur: "نام" },
  "Phone": { en: "Phone", ps: "تلیفون", ur: "فون" },
  "Address": { en: "Address", ps: "ادرس", ur: "پتہ" },
  "City": { en: "City", ps: "ښار", ur: "شہر" },
  "Country": { en: "Country", ps: "هیواد", ur: "ملک" },
  "Product": { en: "Product", ps: "محصول", ur: "مصنوعات" },
  "Quantity": { en: "Quantity", ps: "مقدار", ur: "مقدار" },
  "Rate": { en: "Rate", ps: "نرخ", ur: "شرح" },
  "Cartons": { en: "Cartons", ps: "کارتنونه", ur: "کارٹن" },
  "Balance": { en: "Balance", ps: "بقیه", ur: "بیلنس" },
  "Outstanding": { en: "Outstanding", ps: "پاتې پیسې", ur: "بقایا" },
  "Paid": { en: "Paid", ps: "ورکړل شوي", ur: "ادا شدہ" },
  "Owed": { en: "Owed", ps: "پور", ur: "واجب الادا" },

  // Business specific
  "Lot Number": { en: "Lot Number", ps: "د لاټ شمېره", ur: "لاٹ نمبر" },
  "Distribute to Cities": { en: "Distribute to Cities", ps: "ښارونو ته ویشل", ur: "شہروں میں تقسیم" },
  "Complete Lot": { en: "Complete Lot", ps: "لاټ بشپړول", ur: "لاٹ مکمل" },
  "Reopen": { en: "Reopen", ps: "بیا پرانستل", ur: "دوبارہ کھولیں" },
  "Godown": { en: "Godown", ps: "ګدام", ur: "گودام" },
  "Customer": { en: "Customer", ps: "پیرودونکی", ur: "گاہک" },
  "Supplier": { en: "Supplier", ps: "عرضه کوونکی", ur: "سپلائر" },
  "Expense": { en: "Expense", ps: "مصرف", ur: "خرچہ" },
  "Withdrawal": { en: "Withdrawal", ps: "ایستل", ur: "واپسی" },
  "Haji Transfer": { en: "Haji Transfer", ps: "حاجي لیږد", ur: "حاجی ٹرانسفر" },
  "Payment Method": { en: "Payment Method", ps: "د تادیې لار", ur: "ادائیگی کا طریقہ" },
  "Cash": { en: "Cash", ps: "نغدي", ur: "نقد" },
  "Bank Transfer": { en: "Bank Transfer", ps: "بانکي لیږد", ur: "بینک ٹرانسفر" },
  "Voucher": { en: "Voucher", ps: "واوچر", ur: "واؤچر" },
  "Profit": { en: "Profit", ps: "ګټه", ur: "منافع" },
  "Revenue": { en: "Revenue", ps: "عاید", ur: "آمدنی" },
  "Cost": { en: "Cost", ps: "لګښت", ur: "لاگت" },
  "Net Profit": { en: "Net Profit", ps: "خالصه ګټه", ur: "خالص منافع" },
  "Gross Profit": { en: "Gross Profit", ps: "ناخالصه ګټه", ur: "مجموعی منافع" },
  "Customs Duty": { en: "Customs Duty", ps: "ګمرک محصول", ur: "کسٹم ڈیوٹی" },
  "Freight": { en: "Freight", ps: "بار وړنه", ur: "فریٹ" },
  "Transport": { en: "Transport", ps: "ترانسپورت", ur: "ٹرانسپورٹ" },

  // Pages
  "Payments & Transactions": { en: "Payments & Transactions", ps: "تادیات او راکړه ورکړه", ur: "ادائیگیاں اور لین دین" },
  "Lots / Shipments": { en: "Lots / Shipments", ps: "لاټونه / بارونه", ur: "لاٹ / شپمنٹ" },
  "Profit & Loss": { en: "Profit & Loss", ps: "ګټه او تاوان", ur: "نفع و نقصان" },
  "Cash Position": { en: "Cash Position", ps: "د نغدو حالت", ur: "نقد پوزیشن" },
  "Receivables": { en: "Receivables", ps: "وصولیدونکي", ur: "وصولیاں" },
  "Payables": { en: "Payables", ps: "تادیه کیدونکي", ur: "واجبات" },
  "Balance Sheet": { en: "Balance Sheet", ps: "بیلانس شیټ", ur: "بیلنس شیٹ" },

  // Auth
  "Login": { en: "Login", ps: "ننوتل", ur: "لاگ ان" },
  "Logout": { en: "Logout", ps: "وتل", ur: "لاگ آؤٹ" },
  "Username": { en: "Username", ps: "کارن نوم", ur: "صارف نام" },
  "Password": { en: "Password", ps: "پټنوم", ur: "پاس ورڈ" },

  // Language names
  "English": { en: "English", ps: "English", ur: "English" },
  "پښتو": { en: "پښتو", ps: "پښتو", ur: "پشتو" },
  "اردو": { en: "اردو", ps: "اردو", ur: "اردو" },
};

interface I18nCtx {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
  dir: "ltr" | "rtl";
}

const I18nContext = createContext<I18nCtx>({ lang: "en", setLang: () => {}, t: (k) => k, dir: "ltr" });

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("en");

  useEffect(() => {
    const saved = localStorage.getItem("app_lang") as Lang;
    if (saved && ["en", "ps", "ur"].includes(saved)) setLangState(saved);
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem("app_lang", l);
  };

  const t = (key: string): string => translations[key]?.[lang] || key;
  const dir = lang === "en" ? "ltr" as const : "rtl" as const;

  return <I18nContext.Provider value={{ lang, setLang, t, dir }}>{children}</I18nContext.Provider>;
}

export function useI18n() { return useContext(I18nContext); }

export function LanguageSwitcher() {
  const { lang, setLang } = useI18n();
  return (
    <div className="flex items-center gap-1">
      {(["en", "ps", "ur"] as Lang[]).map(l => (
        <button key={l} onClick={() => setLang(l)}
          className={`px-2 py-1 text-xs rounded ${lang === l ? "bg-primary-600 text-white" : "bg-gray-100 text-gray-600 hover:bg-gray-200"}`}>
          {l === "en" ? "EN" : l === "ps" ? "پښتو" : "اردو"}
        </button>
      ))}
    </div>
  );
}
