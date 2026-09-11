#pragma once
#include <cstdint>
#include <string>
#include <vector>
namespace lenslabs::receipt {
constexpr std::size_t max_input = 8192, max_output = 65536;
struct Model {
  std::uint64_t amount_minor{};
  std::uint32_t exponent{};
  std::string id, issued_on, paid_on, studio, customer, shoot, description, currency, method, source;
};
struct Result { std::string html, text; };
Model parse(const std::vector<std::uint8_t>& bytes);
Result render(const Model& model);
std::string json(const Result& result);
std::string money(std::uint64_t amount, std::uint32_t exponent, const std::string& currency);
}
