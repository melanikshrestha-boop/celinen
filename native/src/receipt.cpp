#include "lenslabs/receipt.hpp"
#include <array>
#include <stdexcept>
#include <utility>

namespace lenslabs::receipt {
namespace {
[[noreturn]] void invalid() { throw std::runtime_error("Invalid receipt input."); }
void text_valid(const std::string& s, std::size_t max, bool optional = false) {
  if (s.size() > max || (!optional && s.find_first_not_of(' ') == std::string::npos)) invalid();
  for (std::size_t i = 0; i < s.size();) {
    const auto first = static_cast<unsigned char>(s[i++]);
    std::uint32_t point = 0; unsigned count = 0;
    if (first < 0x80) point = first;
    else if (first >= 0xc2 && first <= 0xdf) { point = first & 0x1f; count = 1; }
    else if (first >= 0xe0 && first <= 0xef) { point = first & 0x0f; count = 2; }
    else if (first >= 0xf0 && first <= 0xf4) { point = first & 7; count = 3; }
    else invalid();
    if (i + count > s.size()) invalid();
    for (unsigned j = 0; j < count; ++j) {
      const auto next = static_cast<unsigned char>(s[i++]);
      if ((next & 0xc0) != 0x80) invalid();
      point = (point << 6) | (next & 0x3f);
    }
    if ((count == 1 && point < 0x80) || (count == 2 && point < 0x800) || (count == 3 && point < 0x10000) ||
        point > 0x10ffff || (point >= 0xd800 && point <= 0xdfff) || point < 32 || (point >= 127 && point <= 159) ||
        (point >= 0x2028 && point <= 0x202e) || (point >= 0x2066 && point <= 0x2069) || point == 0x200e || point == 0x200f) invalid();
  }
}
bool date_valid(const std::string& s) {
  if (s.size() != 10 || s[4] != '-' || s[7] != '-') return false;
  for (std::size_t i = 0; i < s.size(); ++i) if (i != 4 && i != 7 && (s[i] < '0' || s[i] > '9')) return false;
  const int year = std::stoi(s.substr(0,4)), month = std::stoi(s.substr(5,2)), day = std::stoi(s.substr(8,2));
  const bool leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
  const std::array<int,12> days{31,leap ? 29 : 28,31,30,31,30,31,31,30,31,30,31};
  return year > 0 && month >= 1 && month <= 12 && day >= 1 && day <= days[month - 1];
}
void validate(const Model& m) {
  if (!m.amount_minor || m.amount_minor > 9007199254740991ULL || (m.exponent != 0 && m.exponent != 2 && m.exponent != 3)) invalid();
  text_valid(m.id,128); text_valid(m.issued_on,10); text_valid(m.paid_on,10); text_valid(m.studio,160);
  text_valid(m.customer,160,true); text_valid(m.shoot,200,true); text_valid(m.description,2000);
  text_valid(m.currency,3); text_valid(m.method,80,true); text_valid(m.source,32);
  if (m.currency.size() != 3 || m.currency.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZ") != std::string::npos ||
      !date_valid(m.issued_on) || !date_valid(m.paid_on) || (m.source != "Manually recorded" && m.source != "Provider verified")) invalid();
}
std::string html_escape(const std::string& s) {
  std::string out;
  for (const char c : s) switch(c) {
    case '&': out += "&amp;"; break; case '<': out += "&lt;"; break; case '>': out += "&gt;"; break;
    case '"': out += "&quot;"; break; case '\'': out += "&#39;"; break; default: out += c;
  }
  return out;
}
std::string quote(const std::string& s) {
  std::string out = "\"";
  for (const char c : s) switch(c) {
    case '\\': out += "\\\\"; break; case '"': out += "\\\""; break;
    case '\n': out += "\\n"; break; case '\r': out += "\\r"; break; case '\t': out += "\\t"; break;
    default: if (static_cast<unsigned char>(c) < 32) invalid(); else out += c;
  }
  return out + '"';
}
}
Model parse(const std::vector<std::uint8_t>& bytes) {
  if (bytes.size() < 60 || bytes.size() > max_input) invalid();
  std::size_t offset = 0;
  auto u32 = [&]() { if (bytes.size() - offset < 4) invalid(); std::uint32_t value = 0; for (unsigned i=0;i<4;++i) value = (value << 8) | bytes[offset++]; return value; };
  if (u32() != 0x46524350 || u32() != 1) invalid();
  Model m; m.exponent = u32(); m.amount_minor = static_cast<std::uint64_t>(u32()) << 32; m.amount_minor |= u32();
  const std::array<std::pair<std::string*,std::size_t>,10> fields{{{&m.id,128},{&m.issued_on,10},{&m.paid_on,10},{&m.studio,160},{&m.customer,160},{&m.shoot,200},{&m.description,2000},{&m.currency,3},{&m.method,80},{&m.source,32}}};
  for (const auto& field : fields) {
    const auto length = u32();
    if (length > field.second || length > bytes.size() - offset) invalid();
    field.first->assign(reinterpret_cast<const char*>(bytes.data() + offset),length); offset += length;
  }
  if (offset != bytes.size()) invalid();
  validate(m); return m;
}
std::string money(std::uint64_t amount, std::uint32_t exponent, const std::string& currency) {
  if (amount > 9007199254740991ULL || (exponent != 0 && exponent != 2 && exponent != 3) || currency.size() != 3 || currency.find_first_not_of("ABCDEFGHIJKLMNOPQRSTUVWXYZ") != std::string::npos) invalid();
  auto digits = std::to_string(amount);
  if (exponent) { if (digits.size() <= exponent) digits.insert(0,exponent + 1 - digits.size(),'0'); digits.insert(digits.size() - exponent,1,'.'); }
  return currency + ' ' + digits;
}
Result render(const Model& m) {
  validate(m); Result r;
  const auto amount = money(m.amount_minor,m.exponent,m.currency);
  r.text = "PAYMENT RECEIPT\n" + m.studio + "\n\nReceipt: " + m.id + "\nIssued: " + m.issued_on + "\nPaid: " + m.paid_on + '\n';
  if (!m.customer.empty()) r.text += "Customer: " + m.customer + '\n';
  if (!m.shoot.empty()) r.text += "Shoot: " + m.shoot + '\n';
  r.text += "\n" + m.description + "\n\nAmount paid: " + amount + '\n';
  if (!m.method.empty()) r.text += "Payment method: " + m.method + '\n';
  r.text += "Payment source: " + m.source + "\n\nThank you for your business.\nPayment receipt; not a tax invoice.\n";
  r.html = R"(<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><title>Payment receipt</title><style>*{box-sizing:border-box}html{color-scheme:light;background:#fff;color:#171717}body{margin:0;font:14px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Arial,sans-serif}main{max-width:620px;margin:48px auto;padding:0 32px}header{display:flex;justify-content:space-between;gap:24px;align-items:start}h1{font-size:25px;line-height:1.15;letter-spacing:-.7px;margin:6px 0 0}h2{font-size:17px;margin:0;font-weight:600}p{margin:0}.eyebrow,dt{color:#626262;font-size:12px}.eyebrow{text-transform:uppercase;letter-spacing:1.4px}.ref{text-align:right;overflow-wrap:anywhere;max-width:48%}dl{display:grid;grid-template-columns:100px 1fr;gap:8px 16px;margin:32px 0}dd{margin:0;overflow-wrap:anywhere}.service{padding:20px 0;border-top:1px solid #ddd;border-bottom:1px solid #ddd;overflow-wrap:anywhere}.total{display:flex;justify-content:space-between;align-items:baseline;gap:24px;margin:24px 0 10px}.total strong{font-size:27px;font-weight:600;letter-spacing:-.6px;font-variant-numeric:tabular-nums;overflow-wrap:anywhere}.source{color:#626262;font-size:12px}.thanks{margin-top:36px}footer{margin:10px 0 36px;color:#737373;font-size:11px}@page{size:auto;margin:18mm}@media print{main{max-width:none;margin:0;padding:0}body{-webkit-print-color-adjust:exact;print-color-adjust:exact}.service,.total{break-inside:avoid}}@media(max-width:450px){main{padding:0 22px;margin:28px auto}header{display:block}.ref{text-align:left;max-width:none;margin-top:14px}.total strong{font-size:23px}}</style></head><body><main><header><div><p class="eyebrow">Payment receipt</p><h1>)";
  r.html += html_escape(m.studio) + "</h1></div><p class=\"ref\"><span class=\"eyebrow\">Receipt</span><br>" + html_escape(m.id) + "</p></header><dl>";
  auto row = [&](const std::string& label,const std::string& value) { if (!value.empty()) r.html += "<dt>" + label + "</dt><dd>" + html_escape(value) + "</dd>"; };
  row("Issued",m.issued_on); row("Paid",m.paid_on); row("Customer",m.customer); row("Shoot",m.shoot);
  r.html += "</dl><section class=\"service\" aria-label=\"Service\"><p>" + html_escape(m.description) + "</p></section><div class=\"total\"><span>Amount paid</span><strong>" + amount + "</strong></div>";
  if (!m.method.empty()) r.html += "<p class=\"source\">Payment method: " + html_escape(m.method) + "</p>";
  r.html += "<p class=\"source\">Payment source: " + html_escape(m.source) + "</p><p class=\"thanks\">Thank you for your business.</p><footer>Payment receipt; not a tax invoice.</footer></main></body></html>";
  return r;
}
std::string json(const Result& r) {
  const auto out = "{\"html\":" + quote(r.html) + ",\"text\":" + quote(r.text) + "}";
  if (out.size() > max_output) throw std::runtime_error("Receipt output exceeds limit.");
  return out;
}
}
