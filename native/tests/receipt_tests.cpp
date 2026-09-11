#include "lenslabs/receipt.hpp"
#include <iostream>
#include <stdexcept>
#include <functional>
using namespace lenslabs::receipt;
namespace {
int checks = 0;
void check(bool value) { ++checks; if (!value) throw std::runtime_error("Receipt test failed."); }
void rejects(const std::function<void()>& fn) { bool rejected = false; try { fn(); } catch (...) { rejected = true; } check(rejected); }
Model sample() { return {12345,2,"R-0001","2026-09-08","2026-09-07","FOTO","Zoë & 李","Friday game","Sideline photography","USD","Cash","Manually recorded"}; }
std::vector<std::uint8_t> packet(const Model& m) {
  std::vector<std::uint8_t> bytes;
  const auto put = [&](std::uint32_t n) { for (int shift=24;shift>=0;shift-=8) bytes.push_back(static_cast<std::uint8_t>(n >> shift)); };
  put(0x46524350); put(1); put(m.exponent); put(static_cast<std::uint32_t>(m.amount_minor >> 32)); put(static_cast<std::uint32_t>(m.amount_minor));
  for (const auto* field : {&m.id,&m.issued_on,&m.paid_on,&m.studio,&m.customer,&m.shoot,&m.description,&m.currency,&m.method,&m.source}) {
    put(static_cast<std::uint32_t>(field->size())); bytes.insert(bytes.end(),field->begin(),field->end());
  }
  return bytes;
}
}
int main() {
  try {
    auto m = sample();
    const auto original = packet(m);
    const auto decoded = parse(original);
    const auto result = render(decoded);
    check(decoded.amount_minor == 12345 && decoded.customer == m.customer);
    check(result.text.find("Amount paid: USD 123.45") != std::string::npos);
    check(result.html.find("Zoë &amp; 李") != std::string::npos);
    check(json(result) == json(render(parse(original))));
    check(result.html.find("@media print") != std::string::npos);
    check(result.html.find("default-src 'none'") != std::string::npos);
    check(result.html.find("<script") == std::string::npos);
    check(money(1,0,"JPY") == "JPY 1"); check(money(1,2,"USD") == "USD 0.01"); check(money(1,3,"KWD") == "KWD 0.001");
    check(money(9007199254740991ULL,2,"USD") == "USD 90071992547409.91");
    check(money(9007199254740991ULL,3,"KWD") == "KWD 9007199254740.991");
    rejects([]{money(9007199254740992ULL,2,"USD");}); rejects([]{money(100,1,"USD");});
    for (std::uint64_t i=1;i<=1000;++i) {
      m.amount_minor = i * 1000 + 7; m.exponent = 3; m.currency = "KWD";
      const auto r = render(parse(packet(m)));
      check(r.text.find("KWD " + std::to_string(i) + ".007") != std::string::npos);
      check(r.html.find("KWD " + std::to_string(i) + ".007") != std::string::npos);
    }
    m = sample(); m.description = "</p><script>alert(\"x\")</script> & 'test' \\";
    auto escaped = render(parse(packet(m)));
    check(escaped.html.find("&lt;/p&gt;&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; &amp; &#39;test&#39;") != std::string::npos);
    check(escaped.text.find(m.description) != std::string::npos);
    check(json(escaped).find("\\\\") != std::string::npos);
    m = sample(); m.customer = ""; m.shoot = ""; m.method = ""; m.source = "Provider verified";
    auto optional = render(parse(packet(m)));
    check(optional.text.find("Payment method:") == std::string::npos);
    check(optional.text.find("Customer:") == std::string::npos);
    check(optional.text.find("Provider verified") != std::string::npos);
    for (std::size_t i=0;i<original.size();++i) { auto short_packet = original; short_packet.resize(i); rejects([&]{parse(short_packet);}); }
    auto extra = original; extra.push_back(0); rejects([&]{parse(extra);});
    for (std::size_t offset : {0,4,8,20}) { auto bad = original; bad[offset] = 255; rejects([&]{parse(bad);}); }
    for (const auto& invalid_text : {std::string("\xc0\xaf",2),std::string("\xed\xa0\x80",3),std::string("\xf4\x90\x80\x80",4),std::string("\x80",1),std::string("\xe2\x82",2),std::string("a\0b",3),std::string("a\nb"),std::string("\xc2\x85",2),std::string("\xe2\x80\xae",3)}) {
      m = sample(); m.description = invalid_text; rejects([&]{parse(packet(m));}); rejects([&]{render(m);});
    }
    m = sample(); m.description = std::string(2000,'x'); check(json(render(parse(packet(m)))).size() < max_output);
    m.description += 'x'; rejects([&]{parse(packet(m));});
    for (const auto& date : {"2026-02-29","0000-01-01","2026-13-01","2026-01-00","2026-1-01"}) { m = sample(); m.paid_on = date; rejects([&]{parse(packet(m));}); }
    m = sample(); m.paid_on = "2024-02-29"; check(parse(packet(m)).paid_on == m.paid_on);
    for (const auto& source : {"Paid","Provider verified<script>",""}) { m = sample(); m.source = source; rejects([&]{parse(packet(m));}); }
    m = sample(); m.amount_minor = 0; rejects([&]{parse(packet(m));});
    m.amount_minor = 9007199254740992ULL; rejects([&]{parse(packet(m));});
    std::cout << checks << " receipt assertions passed\n"; return 0;
  } catch (...) { std::cerr << "Receipt tests failed\n"; return 1; }
}
